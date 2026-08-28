// categorizeLlm.ts — Tier 3 LLM categorization queue glue (CAT-4,
// ARCHITECTURE.md §2.3, ADR-0026). Queue glue only, same discipline as
// providerSync.ts: the actual decision logic (turning one provider result
// into a TransactionCategory) lives in categorize/tier3.ts, testable
// without a Redis or an LLM.
import { Queue, Worker, type Job } from "bullmq";
import {
  TransactionRepository,
  CategoryRepository,
  MerchantRuleRepository,
} from "@financial-os/db";
import type { CategorizationCandidate } from "@financial-os/providers";
import {
  QUEUE_NAMES,
  enqueueCategorizeLlm,
  type CategorizeLlmJobData,
  type CategorizeLlmQueueLike,
} from "@financial-os/shared";
import { env } from "../env.js";
import { createRedisConnection } from "../redis.js";
import { getCategorizationProvider } from "../provider.js";
import { resolveUserCategoryNames } from "../categorize/userCategories.js";
import { resolveTier3Outcome } from "../categorize/tier3.js";
import { buildMerchantRuleWriteBack } from "../categorize/writeBack.js";

const transactions = new TransactionRepository();
const categories = new CategoryRepository();
const merchantRules = new MerchantRuleRepository();

export interface CategorizeLlmResult {
  /** How many transactions were needs_review when this run took its
   * snapshot. */
  candidatesConsidered: number;
  /** Written this run as tier: 3 / confirmed. */
  confirmed: number;
  /** Written this run as tier: 3 but still needs_review -- low confidence
   * or the model flagged `uncertain` (categorize/tier3.ts). Stay in the
   * Tier 4 queue, and stay eligible for the next categorize-llm run too:
   * findNeedsReview() filters on status, not tier (ADR-0026). */
  stillNeedsReview: number;
  /** Skipped because a fresh read, taken immediately before the write,
   * found the transaction was no longer needs_review -- a manual Tier 4
   * correction (CAT-7) landed on it while this run's LLM call was in
   * flight. The now-stale LLM verdict is discarded rather than
   * overwriting the human's decision. */
  skippedRace: number;
  /** Confirmed results cached into MerchantRules this run (CAT-6,
   * ADR-0027) -- a subset of `confirmed`, since writeBack.ts only writes
   * back a confirmed category, never a needs_review one. */
  merchantRulesWritten: number;
}

async function runCategorization(userId: string): Promise<CategorizeLlmResult> {
  // The work list comes from the database at run time, not from the job
  // payload (ADR-0025's principle, reused here): a transaction that was
  // already needs_review before this queue existed, or one a previous
  // Tier 3 attempt left low-confidence, is picked up automatically.
  const needsReview = await transactions.findNeedsReview(userId);

  if (needsReview.length === 0) {
    return {
      candidatesConsidered: 0,
      confirmed: 0,
      stillNeedsReview: 0,
      skippedRace: 0,
      merchantRulesWritten: 0,
    };
  }

  const provider = getCategorizationProvider();
  // Once per run, not once per batch (CAT-9, ADR-0028) -- categories don't
  // change mid-run, and this is also where a user's first-ever run seeds
  // their Category rows from DEFAULT_CATEGORY_SEEDS.
  const categoryNames = await resolveUserCategoryNames(categories, userId);
  let confirmed = 0;
  let stillNeedsReview = 0;
  let skippedRace = 0;
  let merchantRulesWritten = 0;

  for (let start = 0; start < needsReview.length; start += env.CATEGORIZE_LLM_BATCH_SIZE) {
    const batch = needsReview.slice(start, start + env.CATEGORIZE_LLM_BATCH_SIZE);
    const candidates: CategorizationCandidate[] = batch.map((tx) => ({
      transactionId: tx._id.toString(),
      normalizedMerchant: tx.merchantNameNormalized,
      description: tx.description,
      amount: tx.amount,
      isoCurrencyCode: tx.isoCurrencyCode,
    }));
    // CAT-6's write-back needs each result's normalized merchant, which
    // CategorizationResult itself doesn't carry (it only echoes
    // transactionId) -- built once per batch rather than re-scanning
    // `batch` per result.
    const merchantByTransactionId = new Map(
      batch.map((tx) => [tx._id.toString(), tx.merchantNameNormalized]),
    );

    const results = await provider.categorizeBatch(candidates, categoryNames);

    for (const result of results) {
      const category = resolveTier3Outcome(result, env.CATEGORIZE_LLM_CONFIDENCE_THRESHOLD);

      // Race guard: `needsReview` is a snapshot taken before this
      // (possibly slow) LLM call. A manual Tier 4 correction landing on
      // this exact transaction in between must not be silently
      // overwritten by a now-stale verdict -- re-check immediately before
      // each write, not just once at the top of the run.
      const current = await transactions.findById(result.transactionId);
      if (!current || current.category.status !== "needs_review") {
        skippedRace += 1;
        continue;
      }

      await transactions.updateCategory(result.transactionId, category);
      if (category.status === "confirmed") {
        confirmed += 1;
      } else {
        stillNeedsReview += 1;
      }

      // CAT-6: cache a confirmed decision into Tier 1 so the same
      // merchant never needs LLM inference again. Skipped race above
      // already discarded stale results before this point, so
      // `current.category.status === "needs_review"` held just before the
      // write this write-back is caching.
      const normalizedMerchant = merchantByTransactionId.get(result.transactionId);
      if (normalizedMerchant) {
        const writeBack = buildMerchantRuleWriteBack(userId, normalizedMerchant, category, "llm");
        if (writeBack) {
          await merchantRules.upsertExact(writeBack);
          merchantRulesWritten += 1;
        }
      }
    }
  }

  const result: CategorizeLlmResult = {
    candidatesConsidered: needsReview.length,
    confirmed,
    stillNeedsReview,
    skippedRace,
    merchantRulesWritten,
  };

  if (result.skippedRace > 0) {
    // Loud on purpose, same reasoning as providerSync.ts's
    // skippedUnknownAccount warning: worth noticing, not worth failing
    // the job over.
    console.warn(
      `[categorize-llm] user=${userId} skipped ${result.skippedRace} transaction(s) a manual correction landed on mid-run`,
    );
  }

  console.info(
    `[categorize-llm] user=${userId} considered=${result.candidatesConsidered} confirmed=${result.confirmed} stillNeedsReview=${result.stillNeedsReview} skippedRace=${result.skippedRace} merchantRulesWritten=${result.merchantRulesWritten}`,
  );

  return result;
}

let categorizeLlmQueue: Queue<CategorizeLlmJobData> | undefined;

function getCategorizeLlmQueue(): Queue<CategorizeLlmJobData> {
  categorizeLlmQueue ??= new Queue<CategorizeLlmJobData>(QUEUE_NAMES.categorizeLlm, {
    connection: createRedisConnection(),
  });
  return categorizeLlmQueue;
}

/** The producer side of this queue (CAT-4). Exported because
 * providerSync.ts, not apps/api, is what triggers a categorization pass:
 * every sync run that touched transactions calls this for that
 * connection's user (§2.3), regardless of whether Tier 1/2 resolved
 * everything this run -- so pre-existing needs_review transactions get
 * swept up too, not just ones from this run. */
export async function triggerCategorizeLlm(userId: string): Promise<void> {
  const queue = getCategorizeLlmQueue() as unknown as CategorizeLlmQueueLike;
  await enqueueCategorizeLlm(queue, userId);
}

export function createCategorizeLlmWorker(): Worker<CategorizeLlmJobData, CategorizeLlmResult> {
  const worker = new Worker<CategorizeLlmJobData, CategorizeLlmResult>(
    QUEUE_NAMES.categorizeLlm,
    async (job: Job<CategorizeLlmJobData>) => runCategorization(job.data.userId),
    {
      connection: createRedisConnection(),
      concurrency: env.CATEGORIZE_LLM_CONCURRENCY,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[categorize-llm] job ${job?.id ?? "unknown"} failed (attempt ${job?.attemptsMade ?? 0}):`,
      err,
    );
  });

  // Same reasoning as providerSync.ts's "ready" handler: a worker that
  // never consumes looks identical to an idle one otherwise -- no error,
  // no output, jobs just sit in `wait`.
  worker.on("ready", () => {
    console.info(`[categorize-llm] worker ready, consuming ${QUEUE_NAMES.categorizeLlm}`);
  });
  worker.on("error", (err) => {
    console.error("[categorize-llm] worker connection error:", err);
  });
  worker.on("active", (job) => {
    console.info(`[categorize-llm] picked up job ${job.id ?? "?"} for user=${job.data.userId}`);
  });

  return worker;
}

export async function closeCategorizeLlmQueue(): Promise<void> {
  await categorizeLlmQueue?.close();
  categorizeLlmQueue = undefined;
}
