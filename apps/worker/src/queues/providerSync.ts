// providerSync.ts — queue glue only (ARCHITECTURE.md §7.5). Everything
// below is wiring: resolve the connection's adapter, hand the real work to
// syncConnection(), log the outcome, translate a provider rate limit into
// a queue-wide pause. Any logic that grows here should move into sync/
// instead, where it can be tested without a Redis.
import { Worker, type Job } from "bullmq";
import {
  AccountRepository,
  ConnectionRepository,
  RawPayloadRepository,
  TransactionRepository,
} from "@financial-os/db";
import { ProviderRateLimitError } from "@financial-os/providers";
import { QUEUE_NAMES, type ProviderSyncJobData } from "@financial-os/shared";
import { env } from "../env.js";
import { getRedisConnection } from "../redis.js";
import { getProviderFor } from "../provider.js";
import { syncConnection, type SyncConnectionResult } from "../sync/syncConnection.js";

const connections = new ConnectionRepository();
const accounts = new AccountRepository();
const transactions = new TransactionRepository();
const rawPayloads = new RawPayloadRepository();

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

  console.info(
    `[provider-sync] connection=${connectionId} pages=${result.pagesProcessed} added=${result.added} modified=${result.modified} removed=${result.removed}`,
  );

  // Two seams deliberately left unwired, each owned by a later story:
  //   - CAT-4 enqueues categorization for result.syncedTransactionIds onto
  //     QUEUE_NAMES.categorizeLlm, keeping ingestion throughput decoupled
  //     from LLM latency (§2.2).
  //   - ANLY-2 consumes result.touchedDay/MonthBuckets as the targeted
  //     rollup recompute signal (ADR-0008).
  // Both are returned from the job so BullMQ records them on the completed
  // job, rather than being recomputed later from scratch.
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
      try {
        return await runSync(job.data.connectionId);
      } catch (err) {
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
      connection: getRedisConnection(),
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

  return worker;
}
