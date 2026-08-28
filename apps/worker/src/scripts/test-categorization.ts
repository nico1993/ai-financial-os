// scripts/test-categorization.ts — a standalone smoke test for the
// CategorizationProvider stack (CAT-4/5, ADR-0026), independent of Mongo,
// Redis, and the categorize-llm queue. Exists because "start the whole
// worker and trigger a real Plaid sync" is a slow way to answer the one
// question this actually needs answering right now: does Ollama, running
// the configured model, produce usable categorization output at all?
//
// Run with:
//   pnpm --filter @financial-os/worker test:categorization [-- --fake] [-- --limit=N]
// or via the repo-root wrapper:
//   bash test-categorization.sh [--fake] [--limit=N]
//
// Needs a populated .env (env.ts validates the full schema on import, the
// same as apps/worker/src/index.ts) but NOT a running Mongo/Redis/Docker
// stack -- this never touches the database or a queue.
//
// Data source: real Plaid sandbox transactions when PLAID_CLIENT_ID/
// PLAID_SECRET hold actual sandbox values and PLAID_ENV is "sandbox";
// otherwise (or with --fake) a small set of synthetic samples. Minting a
// sandbox Item talks to Plaid's sandbox endpoint directly rather than
// through FinancialProvider -- the same carve-out smoke-test.sh documents
// for the same reason: "create a fake bank login" is test scaffolding
// with no equivalent in the app's own adapter interface, since Link is
// what does the real version of this in production. Everything after
// that (exchanging the token, draining the sync cursor) goes through the
// real PlaidProvider, exactly as the app does.
import {
  createPlaidClient,
  PlaidProvider,
  type CategorizationCandidate,
  type CategorizationResult,
  type NormalizedTransaction,
  type ProviderConnectionRef,
} from "@financial-os/providers";
import { env } from "../env.js";
import { getCategorizationProvider } from "../provider.js";
import { DEFAULT_CATEGORIES } from "../categorize/categories.js";
import { resolveTier3Outcome } from "../categorize/tier3.js";
import { normalizeMerchantName } from "../sync/normalize.js";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Plaid's standard sandbox test institution ("First Platypus Bank") --
 * the same one smoke-test.sh mints for its own Plaid round-trip stage.
 * Pre-seeded with a normal, everyday-looking spread of transactions, no
 * flag needed to opt into it. */
const SANDBOX_INSTITUTION_ID = "ins_109508";

/** How many synced transactions to actually categorize by default. Plaid
 * sandbox Items commonly return several dozen once real balance history
 * is included; uncapped would mean a slow run and a wall of table rows
 * for a smoke test that only needs "does this look right". Override with
 * --limit=N. */
const DEFAULT_LIMIT = 20;

const PLACEHOLDER = "REPLACE_ME";

/** Plaid's own docs (transactions/troubleshooting): the very first call
 * to /transactions/sync after an Item is created can legitimately come
 * back with zero transactions and an empty cursor while Plaid is still
 * completing its initial fetch -- not an error (no PRODUCT_NOT_READY),
 * just "nothing yet". The documented fix is to wait for the
 * INITIAL_UPDATE webhook and retry; this script has no webhook receiver
 * to listen on, so it falls back to Plaid's own documented fallback
 * instead: wait a few seconds and call /transactions/sync again. Five
 * escalating retries, ~20s total -- enough for sandbox's usual case
 * without hanging a manual smoke test indefinitely. */
const INITIAL_SYNC_RETRY_DELAYS_MS = [2_000, 3_000, 5_000, 5_000, 5_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A transaction with no real merchant signal at all -- appended to
 * whichever data source is used (real or fake), every run, as a
 * regression canary: does the model honestly report low
 * confidence/uncertain here instead of guessing? A real Plaid sandbox
 * batch usually doesn't happen to include anything this ambiguous on its
 * own, so this is added deliberately rather than hoped for. */
const AMBIGUOUS_CANARY: CategorizationCandidate = {
  transactionId: "canary-ambiguous",
  normalizedMerchant: "sq unknown 4471",
  description: "SQ *4471998201 XKQP",
  amount: -1250,
  isoCurrencyCode: "USD",
};

/** Used only when real Plaid sandbox credentials aren't configured (or
 * --fake is passed). Not real user data; shaped like the kind of Plaid
 * sandbox transactions CAT-1 was built against. Amounts follow Plaid's
 * convention -- positive leaving the account, negative coming in -- the
 * same as everything real Plaid data carries. */
const FAKE_SAMPLE_TRANSACTIONS: CategorizationCandidate[] = [
  {
    transactionId: "fake-1",
    normalizedMerchant: "trader joes",
    description: "TRADER JOE'S #123",
    amount: 4200,
    isoCurrencyCode: "USD",
  },
  {
    transactionId: "fake-2",
    normalizedMerchant: "uber trip",
    description: "UBER *TRIP HELP.UBER.COM",
    amount: 1850,
    isoCurrencyCode: "USD",
  },
  {
    transactionId: "fake-3",
    normalizedMerchant: "netflix com",
    description: "NETFLIX.COM",
    amount: 1599,
    isoCurrencyCode: "USD",
  },
  {
    transactionId: "fake-4",
    normalizedMerchant: "shell oil",
    description: "SHELL OIL 57443021900",
    amount: 5200,
    isoCurrencyCode: "USD",
  },
  {
    transactionId: "fake-5",
    normalizedMerchant: "starbucks store",
    description: "STARBUCKS STORE #04482",
    amount: 675,
    isoCurrencyCode: "USD",
  },
  {
    transactionId: "fake-6",
    normalizedMerchant: "amazon mktplace pmts",
    description: "AMAZON MKTPLACE PMTS",
    amount: 3499,
    isoCurrencyCode: "USD",
  },
  {
    transactionId: "fake-7",
    normalizedMerchant: "ach deposit payroll",
    description: "ACH DEPOSIT PAYROLL ACME CORP",
    amount: -285000,
    isoCurrencyCode: "USD",
  },
];

function pad(value: string, width: number): string {
  return value.length >= width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

function parseArgs(argv: readonly string[]): { fake: boolean; limit: number } {
  const fake = argv.includes("--fake");
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  let limit = DEFAULT_LIMIT;
  if (limitArg) {
    const parsed = Number(limitArg.slice("--limit=".length));
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.error(`${RED}--limit must be a positive integer, got "${limitArg}"${RESET}`);
      process.exit(1);
    }
    limit = parsed;
  }
  return { fake, limit };
}

function hasRealPlaidSandboxCredentials(): boolean {
  return (
    env.PLAID_CLIENT_ID !== PLACEHOLDER &&
    env.PLAID_SECRET !== PLACEHOLDER &&
    env.PLAID_ENV === "sandbox"
  );
}

/** Mints a fresh sandbox Item and exchanges it via the real PlaidProvider
 * -- nothing here is persisted (no Connection is ever written to Mongo),
 * so every run starts clean and there's nothing to clean up after. */
async function mintSandboxConnection(provider: PlaidProvider): Promise<ProviderConnectionRef> {
  let response: Response;
  try {
    response = await fetch("https://sandbox.plaid.com/sandbox/public_token/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.PLAID_CLIENT_ID,
        secret: env.PLAID_SECRET,
        institution_id: SANDBOX_INSTITUTION_ID,
        initial_products: ["transactions"],
      }),
    });
  } catch (err) {
    throw new Error(
      `could not reach Plaid sandbox: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const body = (await response.json()) as {
    public_token?: string;
    error_code?: string;
    error_message?: string;
  };
  if (!response.ok || !body.public_token) {
    throw new Error(
      `sandbox/public_token/create failed (HTTP ${response.status}): ${body.error_code ?? "unknown"} ${body.error_message ?? ""}`.trim(),
    );
  }

  const connection = await provider.createConnection(body.public_token);
  console.log(
    `  sandbox Item created: ${connection.institutionName}, ${connection.accounts.length} account(s)`,
  );
  return { providerItemId: connection.providerItemId, accessToken: connection.accessToken };
}

/** Drains the sync cursor exactly like the real sync job (ARCHITECTURE.md
 * §2.2's pagination loop), just without persisting the cursor anywhere --
 * this is a one-shot script, not a resumable job. Stops once `limit`
 * transactions are collected or the cursor runs out, whichever first;
 * MAX_PAGES is a safety valve against an unbounded loop if Plaid ever
 * returns hasMore: true forever for a sandbox Item. */
async function drainSandboxTransactions(
  provider: PlaidProvider,
  ref: ProviderConnectionRef,
  limit: number,
): Promise<NormalizedTransaction[]> {
  const MAX_PAGES = 10;
  const collected: NormalizedTransaction[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  let pages = 0;

  while (hasMore && collected.length < limit && pages < MAX_PAGES) {
    let page = await provider.syncTransactions(ref, cursor);

    // Only the very first page gets the "not ready yet" retry -- once
    // real paging has started, an empty page mid-drain would be a
    // different (and undocumented) situation, not this one.
    if (pages === 0) {
      for (const delayMs of INITIAL_SYNC_RETRY_DELAYS_MS) {
        if (page.added.length > 0 || page.hasMore) break;
        console.log(
          `  no transactions yet -- Plaid may still be preparing initial data, retrying in ${delayMs / 1000}s...`,
        );
        await sleep(delayMs);
        page = await provider.syncTransactions(ref, cursor);
      }
    }

    collected.push(...page.added);
    cursor = page.nextCursor;
    hasMore = page.hasMore;
    pages += 1;
  }

  return collected.slice(0, limit);
}

function toCandidate(tx: NormalizedTransaction): CategorizationCandidate {
  return {
    transactionId: tx.providerTransactionId,
    normalizedMerchant: normalizeMerchantName(tx),
    description: tx.description,
    amount: tx.amount,
    isoCurrencyCode: tx.isoCurrencyCode,
  };
}

/** Fails loud and early with an actionable message rather than letting
 * the first categorizeBatch() call surface a raw fetch error -- this is
 * the check meant to save the "wait, is Ollama even running?" round trip. */
async function checkOllamaReachable(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${env.OLLAMA_HOST}/api/tags`);
  } catch (err) {
    console.error(`${RED}Could not reach Ollama at ${env.OLLAMA_HOST}.${RESET}`);
    console.error(`  Is it running? Try: ${BOLD}ollama serve${RESET}`);
    console.error(`  (${err instanceof Error ? err.message : String(err)})`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(
      `${RED}Ollama responded ${response.status} ${response.statusText} at ${env.OLLAMA_HOST}/api/tags${RESET}`,
    );
    process.exit(1);
  }

  const body = (await response.json()) as { models?: { name?: string; model?: string }[] };
  const modelNames = (body.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
  const hasModel = modelNames.some(
    (name) => name === env.OLLAMA_MODEL || name.startsWith(`${env.OLLAMA_MODEL}:`),
  );

  console.log(`${GREEN}Ollama reachable${RESET} at ${env.OLLAMA_HOST}`);
  if (modelNames.length > 0) console.log(`  pulled models: ${modelNames.join(", ")}`);

  if (!hasModel) {
    console.error(
      `${YELLOW}Warning:${RESET} configured OLLAMA_MODEL "${env.OLLAMA_MODEL}" doesn't appear in the pulled models list above.`,
    );
    console.error(`  Try: ${BOLD}ollama pull ${env.OLLAMA_MODEL}${RESET}`);
    console.error(
      "  Continuing anyway -- the actual call below will error if it's really missing.",
    );
  }
}

/** Resolves the transaction set to categorize plus a label describing
 * where it came from -- real sandbox data by default, synthetic samples
 * when --fake is passed or real credentials aren't configured, with a
 * fallback to synthetic samples (loudly) if Plaid itself doesn't
 * cooperate. Either way, AMBIGUOUS_CANARY is appended at the end. */
async function resolveCandidates(
  fake: boolean,
  limit: number,
): Promise<{
  candidates: CategorizationCandidate[];
  plaidByTransactionId: Map<string, NormalizedTransaction>;
  sourceLabel: string;
}> {
  const plaidByTransactionId = new Map<string, NormalizedTransaction>();

  if (fake) {
    return {
      candidates: [...FAKE_SAMPLE_TRANSACTIONS, AMBIGUOUS_CANARY],
      plaidByTransactionId,
      sourceLabel: "synthetic samples (--fake)",
    };
  }

  if (!hasRealPlaidSandboxCredentials()) {
    console.log(
      `${YELLOW}No real Plaid sandbox credentials configured (PLAID_CLIENT_ID/PLAID_SECRET are placeholders, or PLAID_ENV isn't "sandbox") -- falling back to synthetic samples.${RESET}`,
    );
    console.log(
      `  ${DIM}Fill in real sandbox keys in .env to test against actual Plaid data.${RESET}`,
    );
    return {
      candidates: [...FAKE_SAMPLE_TRANSACTIONS, AMBIGUOUS_CANARY],
      plaidByTransactionId,
      sourceLabel: "synthetic samples (fallback -- no Plaid sandbox credentials)",
    };
  }

  console.log(
    `Minting a Plaid sandbox Item (${SANDBOX_INSTITUTION_ID}) and pulling real transactions...`,
  );
  const plaidClient = createPlaidClient({
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
    env: env.PLAID_ENV,
  });
  const plaidProvider = new PlaidProvider(plaidClient, {
    clientName: "AI Financial OS (categorization test)",
  });

  try {
    const ref = await mintSandboxConnection(plaidProvider);
    const transactions = await drainSandboxTransactions(plaidProvider, ref, limit);

    if (transactions.length === 0) {
      console.log(
        `${YELLOW}Sandbox Item minted but returned zero transactions -- falling back to synthetic samples.${RESET}`,
      );
      return {
        candidates: [...FAKE_SAMPLE_TRANSACTIONS, AMBIGUOUS_CANARY],
        plaidByTransactionId,
        sourceLabel: "synthetic samples (fallback -- sandbox returned nothing)",
      };
    }

    for (const tx of transactions) plaidByTransactionId.set(tx.providerTransactionId, tx);
    return {
      candidates: [...transactions.map(toCandidate), AMBIGUOUS_CANARY],
      plaidByTransactionId,
      sourceLabel: `${transactions.length} real Plaid sandbox transaction(s) (${SANDBOX_INSTITUTION_ID})`,
    };
  } catch (err) {
    console.error(
      `${RED}Could not pull Plaid sandbox transactions:${RESET} ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error("  Falling back to synthetic samples.");
    return {
      candidates: [...FAKE_SAMPLE_TRANSACTIONS, AMBIGUOUS_CANARY],
      plaidByTransactionId,
      sourceLabel: "synthetic samples (fallback -- Plaid error)",
    };
  }
}

async function main(): Promise<void> {
  const { fake, limit } = parseArgs(process.argv.slice(2));

  console.log(`${BOLD}Testing CategorizationProvider (CAT-4/5, ADR-0026)${RESET}`);
  console.log(`  model:      ${env.OLLAMA_MODEL}`);
  console.log(`  host:       ${env.OLLAMA_HOST}`);
  console.log(`  threshold:  ${env.CATEGORIZE_LLM_CONFIDENCE_THRESHOLD}`);
  console.log(`  batch size: ${env.CATEGORIZE_LLM_BATCH_SIZE}`);
  console.log();

  await checkOllamaReachable();
  console.log();

  const { candidates, plaidByTransactionId, sourceLabel } = await resolveCandidates(fake, limit);
  console.log(`\nData source: ${sourceLabel}`);
  console.log(`Categorizing ${candidates.length} transaction(s)...\n`);

  const provider = getCategorizationProvider();
  const startedAt = Date.now();
  const results: CategorizationResult[] = [];
  try {
    // Same chunking the real categorize-llm job uses (queues/categorizeLlm.ts)
    // -- a --limit above the configured batch size still exercises the
    // multi-batch path faithfully instead of silently sending one giant call.
    for (let start = 0; start < candidates.length; start += env.CATEGORIZE_LLM_BATCH_SIZE) {
      const chunk = candidates.slice(start, start + env.CATEGORIZE_LLM_BATCH_SIZE);
      results.push(...(await provider.categorizeBatch(chunk, DEFAULT_CATEGORIES)));
    }
  } catch (err) {
    console.error(`${RED}categorizeBatch() threw:${RESET}`, err);
    process.exit(1);
  }
  const elapsedMs = Date.now() - startedAt;

  const candidatesById = new Map(candidates.map((c) => [c.transactionId, c]));

  console.log(
    pad("MERCHANT", 24) +
      pad("AMOUNT", 12) +
      pad("CATEGORY", 20) +
      pad("CONF", 6) +
      pad("UNCERTAIN", 10) +
      pad("PLAID PFC", 22) +
      "STATUS",
  );
  console.log("-".repeat(104));

  let hardFallbackCount = 0;
  for (const result of results) {
    const candidate = candidatesById.get(result.transactionId);
    const plaidTx = plaidByTransactionId.get(result.transactionId);
    const outcome = resolveTier3Outcome(result, env.CATEGORIZE_LLM_CONFIDENCE_THRESHOLD);
    const isHardFallback =
      result.category === "Uncategorized" && result.confidence === 0 && result.uncertain;
    if (isHardFallback) hardFallbackCount += 1;

    const amountLabel = candidate
      ? `${(candidate.amount / 100).toFixed(2)} ${candidate.isoCurrencyCode}`
      : "-";
    const statusColor = outcome.status === "confirmed" ? GREEN : YELLOW;
    console.log(
      pad(candidate?.normalizedMerchant ?? result.transactionId, 24) +
        pad(amountLabel, 12) +
        pad(result.category, 20) +
        pad(result.confidence.toFixed(2), 6) +
        pad(String(result.uncertain), 10) +
        pad(plaidTx?.providerCategory ?? "-", 22) +
        `${statusColor}${outcome.status}${RESET}`,
    );
  }

  console.log("-".repeat(104));
  console.log(`\n${results.length} result(s) in ${elapsedMs}ms.`);

  if (hardFallbackCount === results.length) {
    console.error(
      `\n${RED}Every result is the parse-failure fallback (confidence 0, uncertain, "Uncategorized").${RESET}`,
    );
    console.error("  Ollama responded but nothing parsed as usable JSON, even after one retry --");
    console.error("  a real signal the model/prompt needs attention, not that every transaction");
    console.error("  here was genuinely unclassifiable.");
    process.exit(1);
  } else if (hardFallbackCount > 0) {
    console.warn(
      `\n${YELLOW}${hardFallbackCount}/${results.length} result(s) hit the parse-failure fallback.${RESET} Worth a look if it's more than the occasional flake.`,
    );
  }

  console.log(
    `\n${GREEN}Done.${RESET} Eyeball CATEGORY against MERCHANT/AMOUNT (and PLAID PFC, where`,
  );
  console.log("present, as a second opinion) -- this script has no ground truth to grade");
  console.log('against automatically. "canary-ambiguous" is expected to land in needs_review.');
}

main().catch((err: unknown) => {
  console.error("test-categorization failed:", err);
  process.exit(1);
});
