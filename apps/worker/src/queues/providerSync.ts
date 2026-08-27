// providerSync.ts — queue glue only (ARCHITECTURE.md §7.5). Everything
// below is wiring: resolve the connection's adapter, hand the real work to
// syncConnection(), log the outcome, translate a provider rate limit into
// a queue-wide pause. Any logic that grows here should move into sync/
// instead, where it can be tested without a Redis.
import { UnrecoverableError, Worker, type Job } from "bullmq";
import {
  AccountRepository,
  ConnectionRepository,
  MerchantRuleRepository,
  RawPayloadRepository,
  TransactionRepository,
} from "@financial-os/db";
import {
  ProviderConnectionRevokedError,
  ProviderRateLimitError,
  ProviderReauthRequiredError,
} from "@financial-os/providers";
import { QUEUE_NAMES, type ProviderSyncJobData } from "@financial-os/shared";
import { env } from "../env.js";
import { createRedisConnection } from "../redis.js";
import { getProviderFor } from "../provider.js";
import { syncConnection, type SyncConnectionResult } from "../sync/syncConnection.js";

const connections = new ConnectionRepository();
const accounts = new AccountRepository();
const transactions = new TransactionRepository();
const rawPayloads = new RawPayloadRepository();
const merchantRules = new MerchantRuleRepository();

/** Fallback pause when the provider rate-limits us without saying for how
 * long. Long enough to actually clear a per-client limit rather than
 * immediately tripping it again. */
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;

async function runSync(connectionId: string): Promise<SyncConnectionResult> {
  const connection = await connections.findById(connectionId);
  if (!connection) throw new Error(`Connection ${connectionId} not found`);

  const result = await syncConnection(connectionId, {
    provider: getProviderFor(connection.provider),
    connections,
    accounts,
    transactions,
    rawPayloads,
    merchantRules,
  });

  if (result.skippedUnknownAccount.length > 0) {
    // Loud on purpose: these transactions exist in RawPayload but never
    // made it into the ledger, so any total computed from Transactions is
    // incomplete until they're reconciled.
    console.warn(
      `[provider-sync] connection=${connectionId} skipped ${result.skippedUnknownAccount.length} transaction(s) with unresolvable accounts:`,
      result.skippedUnknownAccount,
    );
  }

  if (result.cursorWasReset) {
    console.warn(
      `[provider-sync] connection=${connectionId} had a stale cursor; completed a full resync from empty`,
    );
  }
  if (result.drainRestarts > 0) {
    // Occasional restarts are normal (the bank posted something mid-drain);
    // persistent ones mean the Item is churning faster than we can page it.
    console.warn(
      `[provider-sync] connection=${connectionId} restarted its drain ${result.drainRestarts}x due to mid-pagination mutations`,
    );
  }

  console.info(
    `[provider-sync] connection=${connectionId} pages=${result.pagesProcessed} added=${result.added} modified=${result.modified} removed=${result.removed} pendingSuperseded=${result.pendingSuperseded.length} categorizedTier1=${result.categorizedTier1} categorizedTier2=${result.categorizedTier2}`,
  );

  // One seam deliberately left unwired, owned by a later story: CAT-4
  // enqueues LLM categorization for whatever Tier 1/2 didn't resolve --
  // still needs_review after this job -- onto QUEUE_NAMES.categorizeLlm,
  // keeping ingestion throughput decoupled from LLM latency (§2.2).
  // ANLY-2 consumes result.touchedDay/MonthBuckets as the targeted rollup
  // recompute signal (ADR-0008). Both are returned from the job so BullMQ
  // records them on the completed job, rather than being recomputed later
  // from scratch.
  return result;
}

export function createProviderSyncWorker(): Worker<ProviderSyncJobData, SyncConnectionResult> {
  // Declared before the processor so the processor can close over it —
  // worker.rateLimit() is an instance method, and BullMQ's own documented
  // pattern for provider-driven throttling needs the reference.
  const worker: Worker<ProviderSyncJobData, SyncConnectionResult> = new Worker<
    ProviderSyncJobData,
    SyncConnectionResult
  >(
    QUEUE_NAMES.providerSync,
    async (job: Job<ProviderSyncJobData>) => {
      const { connectionId } = job.data;
      try {
        return await runSync(connectionId);
      } catch (err) {
        // Item error states (ING-10, §6). Both mean retrying is pointless
        // until a human acts, so the Connection is marked and the job is
        // failed as UNRECOVERABLE — that stops BullMQ's remaining attempts
        // immediately rather than burning the retry budget (and Plaid's
        // rate limit) against an Item that cannot succeed. ING-8's poll
        // then skips it, because findSyncable() only returns "active".
        if (err instanceof ProviderReauthRequiredError) {
          await connections.updateStatus(connectionId, "login_required");
          console.warn(
            `[provider-sync] connection=${connectionId} needs re-auth, marked login_required:`,
            err.message,
          );
          throw new UnrecoverableError(`Connection ${connectionId} requires re-authentication`);
        }

        if (err instanceof ProviderConnectionRevokedError) {
          await connections.updateStatus(connectionId, "error");
          console.error(
            `[provider-sync] connection=${connectionId} revoked at the provider, marked error:`,
            err.message,
          );
          throw new UnrecoverableError(`Connection ${connectionId} was revoked at the provider`);
        }

        if (err instanceof ProviderRateLimitError) {
          // Plaid's limits are per-client, not per-connection, so backing
          // off this one job would just let the next connection trip the
          // same limit. Pause the whole queue instead, and re-queue this
          // job WITHOUT consuming an attempt — a 429 is the provider
          // pacing us, not a failure of this connection (ING-6).
          const pauseMs = err.retryAfterMs ?? DEFAULT_RATE_LIMIT_PAUSE_MS;
          console.warn(
            `[provider-sync] rate limited by provider, pausing queue for ${pauseMs}ms:`,
            err.message,
          );
          await worker.rateLimit(pauseMs);
          throw Worker.RateLimitError();
        }
        throw err;
      }
    },
    {
      // Its own connection: a Worker's blocking commands monopolize
      // whatever client it is given (see redis.ts).
      connection: createRedisConnection(),
      concurrency: env.PROVIDER_SYNC_CONCURRENCY,
      // Coarse client-side ceiling so a burst of webhooks doesn't walk
      // into a 429 in the first place; the handler above covers the case
      // where Plaid rate-limits us anyway (§2.2).
      limiter: {
        max: env.PROVIDER_SYNC_RATE_MAX,
        duration: env.PROVIDER_SYNC_RATE_DURATION_MS,
      },
      // Retry counts and backoff live with the enqueue options in
      // packages/shared, since apps/api is what enqueues (ING-7/ING-8).
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[provider-sync] job ${job?.id ?? "unknown"} failed (attempt ${job?.attemptsMade ?? 0}):`,
      err,
    );
  });

  // A worker that never consumes is otherwise indistinguishable from an
  // idle one: no error, no output, jobs just sit in `wait`. These make the
  // difference visible in the log.
  worker.on("ready", () => {
    console.info(`[provider-sync] worker ready, consuming ${QUEUE_NAMES.providerSync}`);
  });
  worker.on("error", (err) => {
    console.error("[provider-sync] worker connection error:", err);
  });
  worker.on("active", (job) => {
    console.info(`[provider-sync] picked up job ${job.id ?? "?"}`);
  });

  return worker;
}
