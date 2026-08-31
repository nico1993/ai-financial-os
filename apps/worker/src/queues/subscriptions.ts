// subscriptions.ts — ANLY-7's nightly subscription-detection batch job,
// queue glue only (ARCHITECTURE.md §4.2). A repeating scheduled job wakes
// up, enumerates every user (mirroring providerSyncScheduler.ts's
// database-driven fan-out -- there's no per-event trigger for this the
// way provider-sync/categorize-llm/transfer-matching/rollups have), and
// delegates the actual decision to ../subscriptions/detect.ts, testable
// without a Redis or a database.
import { Queue, Worker } from "bullmq";
import { SubscriptionRepository, TransactionRepository, UserRepository } from "@financial-os/db";
import {
  QUEUE_NAMES,
  SUBSCRIPTION_DETECTION_SCHEDULER_ID,
  type SubscriptionDetectionJobData,
} from "@financial-os/shared";
import { env } from "../env.js";
import { createRedisConnection } from "../redis.js";
import { detectSubscriptions } from "../subscriptions/detect.js";

const users = new UserRepository();
const transactions = new TransactionRepository();
const subscriptions = new SubscriptionRepository();

export interface SubscriptionDetectionResult {
  usersProcessed: number;
  totalDetected: number;
  totalLapsed: number;
}

async function runForUser(userId: string): Promise<{ detected: number; lapsed: number }> {
  const [candidates, previouslyActive] = await Promise.all([
    transactions.findSubscriptionCandidates(userId),
    subscriptions.findActiveByUser(userId),
  ]);

  const detected = detectSubscriptions(candidates);
  const detectedKeys = new Set(detected.map((d) => d.merchantNameNormalized));

  for (const subscription of detected) {
    await subscriptions.upsertDetected({ userId, ...subscription });
  }

  // A merchant that was active last run but this run's detection no
  // longer confirms has lapsed, not vanished (Subscription.active's own
  // doc comment) -- e.g. a cancelled streaming service simply stops
  // recurring, and the history stays for display rather than being
  // deleted.
  let lapsed = 0;
  for (const existing of previouslyActive) {
    if (!detectedKeys.has(existing.merchantNameNormalized)) {
      await subscriptions.markInactive(userId, existing.merchantNameNormalized);
      lapsed += 1;
    }
  }

  return { detected: detected.length, lapsed };
}

async function runSubscriptionDetection(): Promise<SubscriptionDetectionResult> {
  const userIds = await users.findAllIds();
  let totalDetected = 0;
  let totalLapsed = 0;

  for (const userId of userIds) {
    const { detected, lapsed } = await runForUser(userId);
    totalDetected += detected;
    totalLapsed += lapsed;
  }

  const result: SubscriptionDetectionResult = {
    usersProcessed: userIds.length,
    totalDetected,
    totalLapsed,
  };
  console.info(
    `[subscription-detection] users=${result.usersProcessed} detected=${result.totalDetected} lapsed=${result.totalLapsed}`,
  );
  return result;
}

let schedulerQueue: Queue<SubscriptionDetectionJobData> | undefined;

function getSchedulerQueue(): Queue<SubscriptionDetectionJobData> {
  schedulerQueue ??= new Queue<SubscriptionDetectionJobData>(QUEUE_NAMES.subscriptionDetection, {
    connection: createRedisConnection(),
  });
  return schedulerQueue;
}

/** Registers (or updates) the nightly schedule. Idempotent by scheduler
 * id, so restarting the worker doesn't stack duplicate schedules -- same
 * pattern as registerProviderSyncSchedule(). */
export async function registerSubscriptionDetectionSchedule(): Promise<void> {
  await getSchedulerQueue().upsertJobScheduler(
    SUBSCRIPTION_DETECTION_SCHEDULER_ID,
    { pattern: env.SUBSCRIPTION_DETECTION_CRON },
    { name: "detect", opts: { removeOnComplete: true, removeOnFail: true } },
  );
  console.info(
    `[subscription-detection] scheduled nightly, cron="${env.SUBSCRIPTION_DETECTION_CRON}"`,
  );
}

export function createSubscriptionDetectionWorker(): Worker<
  SubscriptionDetectionJobData,
  SubscriptionDetectionResult
> {
  const worker = new Worker<SubscriptionDetectionJobData, SubscriptionDetectionResult>(
    QUEUE_NAMES.subscriptionDetection,
    // No job argument: like the provider-sync scheduler's poll, this
    // takes no payload and derives its work list from the database.
    async () => runSubscriptionDetection(),
    {
      connection: createRedisConnection(),
      // One at a time: a single run already walks every user, so there's
      // nothing to gain from overlapping runs -- only a risk of two runs
      // racing on the same merchant's upsert/markInactive pair.
      concurrency: 1,
    },
  );

  worker.on("failed", (_job, err) => {
    console.error("[subscription-detection] run failed:", err);
  });
  worker.on("ready", () => {
    console.info(
      `[subscription-detection] worker ready, consuming ${QUEUE_NAMES.subscriptionDetection}`,
    );
  });
  worker.on("error", (err) => {
    console.error("[subscription-detection] worker connection error:", err);
  });

  return worker;
}

export async function closeSubscriptionDetectionQueue(): Promise<void> {
  await schedulerQueue?.close();
  schedulerQueue = undefined;
}
