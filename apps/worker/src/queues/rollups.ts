// rollups.ts — ANLY-1/ANLY-2's queue glue (ARCHITECTURE.md §4.4, ADR-0008,
// ADR-0034). Queue glue only, same discipline as providerSync.ts/
// categorizeLlm.ts/transferMatching.ts: the actual computation lives in
// ../rollups/recompute.ts, testable without a Redis or a database.
import { Queue, Worker, type Job } from "bullmq";
import { AccountRepository, RollupRepository, TransactionRepository } from "@financial-os/db";
import {
  QUEUE_NAMES,
  enqueueRollup,
  type RollupJobData,
  type RollupQueueLike,
} from "@financial-os/shared";
import { env } from "../env.js";
import { createRedisConnection } from "../redis.js";
import { utcMonthEnd } from "../sync/normalize.js";
import {
  computeDailyBalanceSnapshot,
  computeMonthlyRollup,
  type RecomputeAccount,
} from "../rollups/recompute.js";

const accounts = new AccountRepository();
const transactions = new TransactionRepository();
const rollups = new RollupRepository();

export interface RollupResult {
  dayBucketsRecomputed: number;
  monthBucketsRecomputed: number;
}

async function runRollup(data: RollupJobData): Promise<RollupResult> {
  const { userId } = data;
  const dayBuckets = data.dayBuckets.map((iso) => new Date(iso));
  const monthBuckets = data.monthBuckets.map((iso) => new Date(iso));

  // Loaded once per job, not once per bucket (same reasoning as
  // syncConnection.ts's account-map cache): a user's account list doesn't
  // change mid-run, and re-fetching it per bucket would be pure waste.
  const userAccounts = await accounts.findByUserId(userId);
  const recomputeAccounts: RecomputeAccount[] = userAccounts.map((account) => ({
    id: account._id.toString(),
    type: account.type,
    currentBalance: account.currentBalance,
    linkedAt: account.createdAt,
  }));

  for (const day of dayBuckets) {
    const deltas = await transactions.findAccountDeltasAfter(userId, day);
    const snapshot = computeDailyBalanceSnapshot(day, recomputeAccounts, deltas);
    await rollups.upsertDailyBalanceSnapshot({
      userId,
      date: day,
      netWorth: snapshot.netWorth,
      assets: snapshot.assets,
      liabilities: snapshot.liabilities,
      // Plain accountId strings straight through -- RollupRepository is
      // where the ObjectId construction happens (ADR-0034); this module,
      // like computeDailyBalanceSnapshot(), has no business depending on
      // mongoose.
      accounts: snapshot.accounts,
    });
  }

  for (const month of monthBuckets) {
    const monthTransactions = await transactions.findForCashFlow(userId, {
      start: month,
      end: utcMonthEnd(month),
    });
    const rollup = computeMonthlyRollup(monthTransactions);
    await rollups.upsertMonthlyRollupBucket({
      userId,
      month,
      income: rollup.income,
      expenses: rollup.expenses,
    });
  }

  const result: RollupResult = {
    dayBucketsRecomputed: dayBuckets.length,
    monthBucketsRecomputed: monthBuckets.length,
  };

  console.info(
    `[rollups] user=${userId} recomputed ${result.dayBucketsRecomputed} day bucket(s), ${result.monthBucketsRecomputed} month bucket(s)`,
  );

  return result;
}

let rollupsQueue: Queue<RollupJobData> | undefined;

function getRollupsQueue(): Queue<RollupJobData> {
  rollupsQueue ??= new Queue<RollupJobData>(QUEUE_NAMES.rollups, {
    connection: createRedisConnection(),
  });
  return rollupsQueue;
}

/** The producer side of this queue (ANLY-2). Exported because
 * providerSync.ts AND transferMatching.ts both call this -- each with its
 * own touchedDayBuckets/touchedMonthBuckets, independently, not chained
 * through one another (packages/shared's enqueueRollup() doc comment,
 * ADR-0034). */
export async function triggerRollups(
  userId: string,
  dayBuckets: readonly Date[],
  monthBuckets: readonly Date[],
): Promise<void> {
  const queue = getRollupsQueue() as unknown as RollupQueueLike;
  await enqueueRollup(queue, userId, dayBuckets, monthBuckets);
}

export function createRollupsWorker(): Worker<RollupJobData, RollupResult> {
  const worker = new Worker<RollupJobData, RollupResult>(
    QUEUE_NAMES.rollups,
    async (job: Job<RollupJobData>) => runRollup(job.data),
    {
      connection: createRedisConnection(),
      concurrency: env.ROLLUP_CONCURRENCY,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[rollups] job ${job?.id ?? "unknown"} failed (attempt ${job?.attemptsMade ?? 0}):`,
      err,
    );
  });

  // Same reasoning as the other three workers' "ready" handler: a worker
  // that never consumes looks identical to an idle one otherwise -- no
  // error, no output, jobs just sit in `wait`.
  worker.on("ready", () => {
    console.info(`[rollups] worker ready, consuming ${QUEUE_NAMES.rollups}`);
  });
  worker.on("error", (err) => {
    console.error("[rollups] worker connection error:", err);
  });
  worker.on("active", (job) => {
    console.info(`[rollups] picked up job ${job.id ?? "?"} for user=${job.data.userId}`);
  });

  return worker;
}

export async function closeRollupsQueue(): Promise<void> {
  await rollupsQueue?.close();
  rollupsQueue = undefined;
}
