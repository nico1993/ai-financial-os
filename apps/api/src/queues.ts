// queues.ts — apps/api's side of the queue boundary: it produces jobs,
// apps/worker consumes them. Names, payload shapes, and job options come
// from packages/shared so the two agree without importing each other
// (§7.1).
import { Queue } from "bullmq";
import {
  QUEUE_NAMES,
  enqueueProviderSync,
  enqueueRollup,
  type ProviderSyncJobData,
  type ProviderSyncJobOptions,
  type RollupJobData,
  type RollupJobOptions,
} from "@financial-os/shared";
import { getQueueConnection } from "./redis.js";

let providerSyncQueue: Queue<ProviderSyncJobData> | undefined;

function getProviderSyncQueue(): Queue<ProviderSyncJobData> {
  providerSyncQueue ??= new Queue<ProviderSyncJobData>(QUEUE_NAMES.providerSync, {
    connection: getQueueConnection(),
  });
  return providerSyncQueue;
}

let rollupQueue: Queue<RollupJobData> | undefined;

function getRollupQueue(): Queue<RollupJobData> {
  rollupQueue ??= new Queue<RollupJobData>(QUEUE_NAMES.rollups, {
    connection: getQueueConnection(),
  });
  return rollupQueue;
}

/**
 * Requests a sync for one connection. Routes call this rather than
 * touching the Queue directly, so the per-connection dedup key (ING-5) is
 * applied on every path — a webhook, ING-8's scheduled poll, or a manual
 * re-sync from the UI all collapse onto the same job.
 */
export async function requestProviderSync(connectionId: string): Promise<void> {
  // The cast is the seam between BullMQ's own JobsOptions and the
  // structurally-identical shape packages/shared declares to stay
  // dependency-free. If they ever diverge, this is where it surfaces.
  const queue = getProviderSyncQueue() as unknown as {
    add(
      name: string,
      data: ProviderSyncJobData,
      opts: ProviderSyncJobOptions,
    ): Promise<{ id?: string | null } | null>;
  };
  await enqueueProviderSync(queue, connectionId);
}

/**
 * XFER-7: requests a targeted rollup recompute after a manual transfer
 * link (ADR-0008) -- the same signal apps/worker/src/queues/
 * transferMatching.ts's own automated matching pass already emits for
 * exactly this reason (linking sets excludeFromCashFlow, which stales a
 * MonthlyRollup already computed for that bucket). routes/transactions.ts's
 * link-transfer route is the only apps/api write that ever sets
 * excludeFromCashFlow, so it's the only call site that needs this.
 */
export async function requestRollup(
  userId: string,
  dayBuckets: readonly Date[],
  monthBuckets: readonly Date[],
): Promise<void> {
  const queue = getRollupQueue() as unknown as {
    add(
      name: string,
      data: RollupJobData,
      opts: RollupJobOptions,
    ): Promise<{ id?: string | null } | null>;
  };
  await enqueueRollup(queue, userId, dayBuckets, monthBuckets);
}

export async function closeQueues(): Promise<void> {
  await providerSyncQueue?.close();
  providerSyncQueue = undefined;
  await rollupQueue?.close();
  rollupQueue = undefined;
}
