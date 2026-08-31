// @financial-os/worker
// Plain Node/TS process — BullMQ queues: provider-sync, categorize-llm,
// transfer-matching, rollups. All four exist today (ING-4, ING-8, CAT-4,
// XFER-2, ANLY-1/ANLY-2).
import { connectDb, disconnectDb } from "@financial-os/db";
import { createProviderSyncWorker } from "./queues/providerSync.js";
import { closeRedisConnections } from "./redis.js";
import {
  closeSchedulerQueues,
  createProviderSyncSchedulerWorker,
  registerProviderSyncSchedule,
} from "./queues/providerSyncScheduler.js";
import { closeCategorizeLlmQueue, createCategorizeLlmWorker } from "./queues/categorizeLlm.js";
import {
  closeTransferMatchingQueue,
  createTransferMatchingWorker,
} from "./queues/transferMatching.js";
import { closeRollupsQueue, createRollupsWorker } from "./queues/rollups.js";
import {
  closeSubscriptionDetectionQueue,
  createSubscriptionDetectionWorker,
  registerSubscriptionDetectionSchedule,
} from "./queues/subscriptions.js";
import { env } from "./env.js";

async function main(): Promise<void> {
  await connectDb({ uri: env.MONGO_URI });

  const workers = [
    createProviderSyncWorker(),
    createProviderSyncSchedulerWorker(),
    createCategorizeLlmWorker(),
    createTransferMatchingWorker(),
    createRollupsWorker(),
    createSubscriptionDetectionWorker(),
  ];

  // Idempotent by scheduler id, so restarts update the existing schedule
  // rather than stacking duplicates.
  await registerProviderSyncSchedule();
  await registerSubscriptionDetectionSchedule();

  console.info(`[worker] started ${workers.length} queue worker(s)`);

  // Close workers before the DB so an in-flight job finishes its writes: a
  // job killed mid-drain is safe (the cursor is persisted per page), but
  // one killed mid-write against a closed connection is not.
  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[worker] ${signal} received, draining...`);
    await Promise.all(workers.map((worker) => worker.close()));
    await closeSchedulerQueues();
    await closeCategorizeLlmQueue();
    await closeTransferMatchingQueue();
    await closeRollupsQueue();
    await closeSubscriptionDetectionQueue();
    await closeRedisConnections();
    await disconnectDb();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  console.error("apps/worker failed to start:", err);
  process.exit(1);
});
