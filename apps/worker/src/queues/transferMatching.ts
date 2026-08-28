// transferMatching.ts — transfer-matching queue glue (XFER-2..XFER-5,
// ARCHITECTURE.md §2.4, ADR-0006, ADR-0029). Queue glue only, same
// discipline as categorizeLlm.ts/providerSync.ts: the actual matching
// decision lives in ../transfer/matching.ts, testable without a Redis or
// a database.
import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { TransactionRepository } from "@financial-os/db";
import {
  QUEUE_NAMES,
  enqueueTransferMatching,
  type TransferMatchingJobData,
  type TransferMatchingQueueLike,
} from "@financial-os/shared";
import { env } from "../env.js";
import { createRedisConnection } from "../redis.js";
import { utcDayStart, utcMonthStart } from "../sync/normalize.js";
import { findTransferMatches, isTransferSignalCategory } from "../transfer/matching.js";

const transactions = new TransactionRepository();

export interface TransferMatchingResult {
  /** Size of the unmatched pool this run considered (§2.4's candidate
   * set: every non-removed, settled, not-yet-grouped transaction for this
   * user -- TransactionRepository.findUnmatchedTransferCandidates()). */
  candidatesConsidered: number;
  /** Pairs linked this run (XFER-3) -- 2x this many transactions had
   * transferGroupId/excludeFromCashFlow set. */
  matched: number;
  /** Still-unmatched TRANSFER_-prefixed/payment-type transactions old enough to
   * age into the Tier 4 review queue this run (XFER-4). */
  agedToReview: number;
  /** UTC day/month buckets this run touched -- the same recompute signal
   * ADR-0008 asks every transaction-mutating job to emit (XFER-5). Only
   * covers actual matches: aging changes category.status/tier, neither of
   * which any rollup aggregates over, so it doesn't stale one (unlike
   * excludeFromCashFlow, which a match write does change). ANLY-2 will
   * consume this the same way providerSync.ts's result already documents
   * it will. */
  touchedDayBuckets: Date[];
  touchedMonthBuckets: Date[];
}

async function runTransferMatching(userId: string): Promise<TransferMatchingResult> {
  // The candidate pool comes from the database at run time, not from the
  // job payload (ADR-0025's principle, reused again here): every unmatched
  // eligible transaction is reconsidered on every run, not just ones from
  // whatever sync batch triggered this job.
  const candidates = await transactions.findUnmatchedTransferCandidates(userId);

  if (candidates.length === 0) {
    return {
      candidatesConsidered: 0,
      matched: 0,
      agedToReview: 0,
      touchedDayBuckets: [],
      touchedMonthBuckets: [],
    };
  }

  const matchInputs = candidates.map((tx) => ({
    id: tx._id.toString(),
    accountId: tx.accountId.toString(),
    amount: tx.amount,
    date: tx.date,
    providerCategory: tx.providerCategory,
  }));

  const pairs = findTransferMatches(matchInputs, {
    dateToleranceDays: env.XFER_MATCH_DATE_TOLERANCE_DAYS,
    amountToleranceCents: env.XFER_MATCH_AMOUNT_TOLERANCE_CENTS,
  });

  const byId = new Map(candidates.map((tx) => [tx._id.toString(), tx]));
  const dayBuckets = new Map<string, Date>();
  const monthBuckets = new Map<string, Date>();

  function recordBucket(date: Date): void {
    const day = utcDayStart(date);
    const month = utcMonthStart(date);
    dayBuckets.set(day.toISOString(), day);
    monthBuckets.set(month.toISOString(), month);
  }

  const matchedIds = new Set<string>();
  for (const pair of pairs) {
    // XFER-3: TransactionRepository.applyTransferMatch() was already
    // built and tested ahead of this story landing -- this job's only
    // addition is generating a fresh group id per pair and calling it.
    await transactions.applyTransferMatch([pair.anchorId, pair.counterpartId], randomUUID());
    matchedIds.add(pair.anchorId);
    matchedIds.add(pair.counterpartId);
    const anchor = byId.get(pair.anchorId);
    const counterpart = byId.get(pair.counterpartId);
    if (anchor) recordBucket(anchor.date);
    if (counterpart) recordBucket(counterpart.date);
  }

  // XFER-4: still-unmatched, transfer/payment-signal-tagged transactions
  // old enough (by their own transaction date, not createdAt -- ACH
  // settlement variance is measured from when the money actually moved)
  // age into the Tier 4 review queue. Only downgrades a currently
  // `confirmed` category -- one already `needs_review` (never resolved
  // past Tier 1/2/3, or aged by a previous run) needs no re-flagging, and
  // skipping it keeps this idempotent across runs. `value` is preserved,
  // not reset to Uncategorized: whatever Tier 1/2/3 decided is still the
  // best guess on record, this just asks a human to confirm it given a
  // transfer signal that never found its other half.
  const ageThresholdMs = Date.now() - env.XFER_UNMATCHED_AGE_DAYS * 24 * 60 * 60 * 1000;
  let agedToReview = 0;
  for (const tx of candidates) {
    const id = tx._id.toString();
    if (matchedIds.has(id)) continue;
    if (!isTransferSignalCategory(tx.providerCategory)) continue;
    if (tx.category.status !== "confirmed") continue;
    if (tx.date.getTime() > ageThresholdMs) continue;

    await transactions.updateCategory(id, {
      tier: 4,
      value: tx.category.value,
      status: "needs_review",
    });
    agedToReview += 1;
  }

  const result: TransferMatchingResult = {
    candidatesConsidered: candidates.length,
    matched: pairs.length,
    agedToReview,
    touchedDayBuckets: [...dayBuckets.values()],
    touchedMonthBuckets: [...monthBuckets.values()],
  };

  console.info(
    `[transfer-matching] user=${userId} considered=${result.candidatesConsidered} matched=${result.matched} agedToReview=${result.agedToReview}`,
  );

  return result;
}

let transferMatchingQueue: Queue<TransferMatchingJobData> | undefined;

function getTransferMatchingQueue(): Queue<TransferMatchingJobData> {
  transferMatchingQueue ??= new Queue<TransferMatchingJobData>(QUEUE_NAMES.transferMatching, {
    connection: createRedisConnection(),
  });
  return transferMatchingQueue;
}

/** The producer side of this queue (XFER-2). Exported because
 * categorizeLlm.ts, not apps/api, is what triggers a matching pass: every
 * categorize-llm run for a user calls this once it completes, regardless
 * of how many (if any) transactions it confirmed -- §2.4 says this pass
 * "runs after categorization completes for a sync batch", and every
 * categorize-llm run corresponds to one (providerSync.ts only ever
 * triggers categorize-llm when a sync actually touched transactions).
 * Matching itself reads Transaction.providerCategory (ADR-0029), a raw
 * provider signal set at sync time -- it doesn't actually depend on Tier
 * 1-4 having resolved anything, but chaining off categorize-llm keeps the
 * pipeline's stage order exactly what §2.4/apps/worker's own index.ts
 * comment describe: provider-sync -> categorize-llm -> transfer-matching
 * -> rollups. */
export async function triggerTransferMatching(userId: string): Promise<void> {
  const queue = getTransferMatchingQueue() as unknown as TransferMatchingQueueLike;
  await enqueueTransferMatching(queue, userId);
}

export function createTransferMatchingWorker(): Worker<
  TransferMatchingJobData,
  TransferMatchingResult
> {
  const worker = new Worker<TransferMatchingJobData, TransferMatchingResult>(
    QUEUE_NAMES.transferMatching,
    async (job: Job<TransferMatchingJobData>) => runTransferMatching(job.data.userId),
    {
      connection: createRedisConnection(),
      concurrency: env.XFER_MATCHING_CONCURRENCY,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[transfer-matching] job ${job?.id ?? "unknown"} failed (attempt ${job?.attemptsMade ?? 0}):`,
      err,
    );
  });

  // Same reasoning as providerSync.ts's/categorizeLlm.ts's "ready"
  // handler: a worker that never consumes looks identical to an idle one
  // otherwise -- no error, no output, jobs just sit in `wait`.
  worker.on("ready", () => {
    console.info(`[transfer-matching] worker ready, consuming ${QUEUE_NAMES.transferMatching}`);
  });
  worker.on("error", (err) => {
    console.error("[transfer-matching] worker connection error:", err);
  });
  worker.on("active", (job) => {
    console.info(`[transfer-matching] picked up job ${job.id ?? "?"} for user=${job.data.userId}`);
  });

  return worker;
}

export async function closeTransferMatchingQueue(): Promise<void> {
  await transferMatchingQueue?.close();
  transferMatchingQueue = undefined;
}
