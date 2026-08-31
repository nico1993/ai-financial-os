// detect.ts — ANLY-7's subscription-detection heuristic (ARCHITECTURE.md
// §4.2), kept free of BullMQ and Mongoose (§7.5). Pure function: given a
// user's candidate transactions, decides which recurring merchants look
// like subscriptions. The queue glue (../queues/subscriptions.ts) is what
// loads the candidate pool and writes the result -- same split as
// sync/syncConnection.ts vs. categorize/tier1.ts.
export interface SubscriptionCandidateTransaction {
  id: string;
  merchantNameNormalized: string;
  merchantName: string;
  /** Integer cents, Plaid convention: positive = money leaving the
   * account. Only positive amounts are ever subscription candidates --
   * see detectSubscriptions()'s own doc comment. */
  amount: number;
  date: Date;
}

export type SubscriptionFrequency = "monthly" | "annual";

export interface DetectedSubscription {
  merchantNameNormalized: string;
  merchantName: string;
  /** The most recent transaction's amount -- a subscription's "current
   * price," which can drift slightly within tolerance over time. */
  amount: number;
  intervalDays: number;
  frequency: SubscriptionFrequency;
  lastTransactionDate: Date;
  nextExpectedDate: Date;
  transactionIds: string[];
}

export interface SubscriptionDetectionOptions {
  /** §4.2: "≥3 transactions." */
  minOccurrences: number;
  /** How far an individual amount may drift from the group's median and
   * still count as "the same subscription" -- a fraction of the median
   * (0.15 = ±15%), covering a price increase (Netflix, streaming
   * services) without also accepting an unrelated one-off purchase at the
   * same merchant. */
  amountToleranceFraction: number;
  monthlyTargetDays: number;
  monthlyToleranceDays: number;
  annualTargetDays: number;
  annualToleranceDays: number;
  /** §4.2's "simple standard-deviation-on-interval check": the population
   * standard deviation of the gaps between consecutive transactions must
   * fall at or under this many days, or the merchant is rejected even if
   * its *average* interval happens to land near 30/365 -- three payments
   * 5, 65, and 125 days apart average to ~60 but are not a monthly
   * subscription. */
  maxIntervalStdDevDays: number;
}

export const DEFAULT_SUBSCRIPTION_DETECTION_OPTIONS: SubscriptionDetectionOptions = {
  minOccurrences: 3,
  amountToleranceFraction: 0.15,
  monthlyTargetDays: 30,
  monthlyToleranceDays: 5,
  annualTargetDays: 365,
  annualToleranceDays: 20,
  maxIntervalStdDevDays: 5,
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Population standard deviation -- this is describing the actual spread
 * of a fixed, fully-known set of intervals, not estimating a larger
 * population from a sample, so no Bessel's correction. */
function populationStdDev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const variance = mean(values.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY;
}

/**
 * Detects recurring-subscription merchants from a candidate transaction
 * pool (§4.2's Phase 1 heuristic): group by `merchantNameNormalized`, flag
 * as recurring any merchant with at least `minOccurrences` transactions
 * whose amounts fall within a tolerance band of their median AND whose
 * inter-transaction intervals cluster tightly (population std-dev at or
 * under `maxIntervalStdDevDays`) around either ~30 or ~365 days.
 *
 * Only positive amounts are ever considered (Plaid convention: positive =
 * money leaving the account) -- a subscription is something you PAY for;
 * a same-merchant refund or reversal is not a second data point for
 * "recurs every 30 days," it's noise that would corrupt the interval math
 * if left in.
 *
 * A merchant matching neither the monthly nor annual window (e.g. a
 * genuinely weekly charge, or an irregular one) is not detected at all --
 * §4.2 names only these two clusters for Phase 1; nothing here invents a
 * third "other" bucket despite `Subscription.frequency`'s type allowing
 * one (reserved for a future heuristic this function doesn't implement,
 * ADR-0036).
 *
 * `transactions` need not be pre-sorted or pre-grouped -- this function
 * does both. The caller (../queues/subscriptions.ts) is expected to have
 * already excluded removed and pending transactions, the same discipline
 * TransactionRepository.findForCashFlow()/findAccountDeltasAfter() apply
 * for their own callers.
 */
export function detectSubscriptions(
  transactions: readonly SubscriptionCandidateTransaction[],
  options: SubscriptionDetectionOptions = DEFAULT_SUBSCRIPTION_DETECTION_OPTIONS,
): DetectedSubscription[] {
  const byMerchant = new Map<string, SubscriptionCandidateTransaction[]>();
  for (const tx of transactions) {
    if (tx.amount <= 0) continue;
    const group = byMerchant.get(tx.merchantNameNormalized);
    if (group) group.push(tx);
    else byMerchant.set(tx.merchantNameNormalized, [tx]);
  }

  const results: DetectedSubscription[] = [];

  for (const [merchantKey, group] of byMerchant) {
    if (group.length < options.minOccurrences) continue;

    const sorted = [...group].sort((a, b) => a.date.getTime() - b.date.getTime());

    const amounts = sorted.map((t) => t.amount);
    const med = median(amounts);
    const amountTolerance = med * options.amountToleranceFraction;
    const withinAmountBand = amounts.every((a) => Math.abs(a - med) <= amountTolerance);
    if (!withinAmountBand) continue;

    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev && curr) intervals.push(daysBetween(prev.date, curr.date));
    }
    const avgInterval = mean(intervals);
    if (populationStdDev(intervals) > options.maxIntervalStdDevDays) continue;

    let frequency: SubscriptionFrequency | undefined;
    if (Math.abs(avgInterval - options.monthlyTargetDays) <= options.monthlyToleranceDays) {
      frequency = "monthly";
    } else if (Math.abs(avgInterval - options.annualTargetDays) <= options.annualToleranceDays) {
      frequency = "annual";
    }
    if (!frequency) continue;

    const last = sorted[sorted.length - 1];
    if (!last) continue; // unreachable (group.length already >= minOccurrences), satisfies noUncheckedIndexedAccess
    const intervalDays = Math.round(avgInterval);

    results.push({
      merchantNameNormalized: merchantKey,
      merchantName: last.merchantName,
      amount: last.amount,
      intervalDays,
      frequency,
      lastTransactionDate: last.date,
      nextExpectedDate: new Date(last.date.getTime() + intervalDays * 24 * 60 * 60 * 1000),
      transactionIds: sorted.map((t) => t.id),
    });
  }

  return results;
}
