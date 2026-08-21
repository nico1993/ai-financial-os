// queues.ts — apps/api's side of the queue boundary: it produces jobs,
// apps/worker consumes them. Names, payload shapes, and job options come
// from packages/shared so the two agree without importing each other
// (§7.1).
import { Queue } from "bullmq";
import {
  QUEUE_NAMES,
  enqueueProviderSync,
  type ProviderSyncJobData,
  type ProviderSyncJobOptions,
} from "@financial-os/shared";
import { getQueueConnection } from "./redis.js";

let providerSyncQueue: Queue<ProviderSyncJobData> | undefined;

function getProviderSyncQueue(): Queue<ProviderSyncJobData> {
  providerSyncQueue ??= new Queue<ProviderSyncJobData>(QUEUE_NAMES.providerSync, {
    connection: getQueueConnection(),
  });
  return providerSyncQueue;
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

export async function closeQueues(): Promise<void> {
  await providerSyncQueue?.close();
  providerSyncQueue = undefined;
}
