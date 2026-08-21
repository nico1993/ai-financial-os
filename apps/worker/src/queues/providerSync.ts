// providerSync.ts — queue glue only (ARCHITECTURE.md §7.5). Everything
// below is wiring: resolve the connection's adapter, hand the real work to
// syncConnection(), log the outcome. Any logic that grows here should move
// into sync/ instead, where it can be tested without a Redis.
import { Worker, type Job } from "bullmq";
import {
  AccountRepository,
  ConnectionRepository,
  RawPayloadRepository,
  TransactionRepository,
} from "@financial-os/db";
import { QUEUE_NAMES, type ProviderSyncJobData } from "@financial-os/shared";
import { env } from "../env.js";
import { getRedisConnection } from "../redis.js";
import { getProviderFor } from "../provider.js";
import { syncConnection, type SyncConnectionResult } from "../sync/syncConnection.js";

const connections = new ConnectionRepository();
const accounts = new AccountRepository();
const transactions = new TransactionRepository();
const rawPayloads = new RawPayloadRepository();

async function processProviderSync(job: Job<ProviderSyncJobData>): Promise<SyncConnectionResult> {
  const { connectionId } = job.data;

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
  const worker = new Worker<ProviderSyncJobData, SyncConnectionResult>(
    QUEUE_NAMES.providerSync,
    processProviderSync,
    {
      connection: getRedisConnection(),
      concurrency: env.PROVIDER_SYNC_CONCURRENCY,
      // ING-5 adds the per-connection idempotency lock and ING-6 the
      // rate limiter + 429 backoff; both are queue/job options that slot
      // in here without touching the handler above.
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[provider-sync] job ${job?.id ?? "unknown"} failed:`, err);
  });

  return worker;
}
