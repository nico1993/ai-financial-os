// providerSyncScheduler.ts — ING-8's webhook-miss safety net (§2.2).
//
// Queue glue only. A repeating job wakes up every few hours, asks the
// database which connections are syncable, and enqueues a normal
// provider-sync job for each. Because those go through ING-5's shared
// enqueue helper, a poll landing on a connection that a webhook already
// queued collapses into the same job rather than racing it.
import { Queue, Worker } from "bullmq";
import { ConnectionRepository } from "@financial-os/db";
import {
  PROVIDER_SYNC_SCHEDULER_ID,
  QUEUE_NAMES,
  enqueueProviderSync,
  type ProviderSyncJobData,
  type ProviderSyncJobOptions,
  type ProviderSyncScheduleJobData,
} from "@financial-os/shared";
import { env } from "../env.js";
import { getRedisConnection } from "../redis.js";

const connections = new ConnectionRepository();

let providerSyncQueue: Queue<ProviderSyncJobData> | undefined;
let schedulerQueue: Queue<ProviderSyncScheduleJobData> | undefined;

function getProviderSyncQueue(): Queue<ProviderSyncJobData> {
  providerSyncQueue ??= new Queue<ProviderSyncJobData>(QUEUE_NAMES.providerSync, {
    connection: getRedisConnection(),
  });
  return providerSyncQueue;
}

function getSchedulerQueue(): Queue<ProviderSyncScheduleJobData> {
  schedulerQueue ??= new Queue<ProviderSyncScheduleJobData>(QUEUE_NAMES.providerSyncScheduler, {
    connection: getRedisConnection(),
  });
  return schedulerQueue;
}

async function runScheduledPoll(): Promise<{ enqueued: number }> {
  // findSyncable() excludes login_required/error connections: §6 is
  // explicit that a broken Item should stop being retried until the user
  // acts, and a job that re-polls it every few hours is exactly the
  // retry-budget burn it warns about (ING-10).
  const syncable = await connections.findSyncable();

  const queue = getProviderSyncQueue() as unknown as {
    add(
      name: string,
      data: ProviderSyncJobData,
      opts: ProviderSyncJobOptions,
    ): Promise<{ id?: string | null } | null>;
  };

  for (const connection of syncable) {
    await enqueueProviderSync(queue, connection._id.toString());
  }

  console.info(`[provider-sync-scheduler] enqueued ${syncable.length} connection(s)`);
  return { enqueued: syncable.length };
}

/** Registers (or updates) the repeating schedule. Idempotent by scheduler
 * id, so restarting the worker doesn't stack duplicate schedules. */
export async function registerProviderSyncSchedule(): Promise<void> {
  await getSchedulerQueue().upsertJobScheduler(
    PROVIDER_SYNC_SCHEDULER_ID,
    { every: env.PROVIDER_SYNC_POLL_INTERVAL_MS },
    { name: "poll", opts: { removeOnComplete: true, removeOnFail: true } },
  );
  console.info(
    `[provider-sync-scheduler] polling every ${Math.round(env.PROVIDER_SYNC_POLL_INTERVAL_MS / 60_000)} minutes`,
  );
}

export function createProviderSyncSchedulerWorker(): Worker<
  ProviderSyncScheduleJobData,
  { enqueued: number }
> {
  const worker = new Worker<ProviderSyncScheduleJobData, { enqueued: number }>(
    QUEUE_NAMES.providerSyncScheduler,
    // No job argument: the poll takes no payload and derives its work
    // list from the database at run time.
    async () => runScheduledPoll(),
    {
      connection: getRedisConnection(),
      // One at a time: this only fans out enqueues, and overlapping runs
      // would just duplicate work the dedup key then discards.
      concurrency: 1,
    },
  );

  worker.on("failed", (_job, err) => {
    console.error("[provider-sync-scheduler] poll failed:", err);
  });

  return worker;
}

export async function closeSchedulerQueues(): Promise<void> {
  await providerSyncQueue?.close();
  await schedulerQueue?.close();
  providerSyncQueue = undefined;
  schedulerQueue = undefined;
}
