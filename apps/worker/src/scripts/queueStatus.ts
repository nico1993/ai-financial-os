// Dev utility: show what is actually sitting in the queues.
//
//   pnpm --filter @financial-os/worker exec tsx src/scripts/queueStatus.ts
//
// A job stuck in `waiting` means it was enqueued but nothing is consuming
// it (the classic cause is two Workers sharing one Redis connection — see
// redis.ts). A job in `failed` means it ran and threw, and the reason is
// printed below.
import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@financial-os/shared";
import { createRedisConnection, closeRedisConnections } from "../redis.js";

async function report(name: string): Promise<void> {
  const queue = new Queue(name, { connection: createRedisConnection() });

  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
    "paused",
  );
  console.info(`\n${name}`);
  console.info("  " + JSON.stringify(counts));

  const waiting = await queue.getJobs(["waiting"], 0, 9);
  for (const job of waiting) {
    console.info(`  waiting  id=${job.id ?? "?"} data=${JSON.stringify(job.data)}`);
  }

  const failed = await queue.getJobs(["failed"], 0, 9);
  for (const job of failed) {
    console.info(`  failed   id=${job.id ?? "?"} data=${JSON.stringify(job.data)}`);
    console.info(`           reason: ${job.failedReason ?? "(none recorded)"}`);
  }

  const schedulers = await queue.getJobSchedulers(0, 9);
  for (const scheduler of schedulers) {
    console.info(`  schedule id=${scheduler.key ?? "?"} every=${scheduler.every ?? "?"}ms`);
  }

  await queue.close();
}

async function main(): Promise<void> {
  await report(QUEUE_NAMES.providerSync);
  await report(QUEUE_NAMES.providerSyncScheduler);
  await closeRedisConnections();
}

main().catch((err: unknown) => {
  console.error("queue status failed:", err);
  process.exit(1);
});
