// lib/balanceGraphGranularity.ts — ANLY-13's Days/Weeks/Months toggle for
// Overview's balance graph. Pure logic (no React, no fetch), tested
// directly rather than through a mounted page -- same split
// lib/dateRange.ts and components/charts/netWorthGaps.ts already
// establish for this app's chart-adjacent pure logic (AGENTS.md's
// test-first rule for pure-logic stories).
//
// NetWorthChart.tsx itself is unchanged and stays daily-granularity-only
// -- it just draws whatever series it's handed. This is the client-side
// downsample OverviewPage.tsx runs on useNetWorthQuery()'s daily series
// BEFORE handing it to that chart, per BACKLOG.md's own ANLY-13 note:
// "doable as a client-side downsample of the existing daily series (last
// value per week/month) rather than a new backend aggregation, since
// DailyBalanceSnapshot already has full daily resolution within any
// requested range."
import type { NetWorthPoint } from "../api/analytics";

export type BalanceGraphGranularity = "day" | "week" | "month";

export const BALANCE_GRAPH_GRANULARITIES: readonly BalanceGraphGranularity[] = [
  "day",
  "week",
  "month",
];

/** Groups `date` into the UTC calendar month it falls in, keyed by that
 * month's first day. */
function monthBucketKey(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

/** Groups `date` into a Monday-starting week, keyed by that Monday.
 * Doesn't need to be ISO-8601-precise (no week-numbering, no
 * year-boundary edge cases to get right) -- this key is only ever
 * compared to itself for grouping, never displayed or persisted. */
function weekBucketKey(date: Date): string {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = dayStart.getUTCDay(); // 0 (Sun) .. 6 (Sat)
  const daysSinceMonday = (weekday + 6) % 7;
  dayStart.setUTCDate(dayStart.getUTCDate() - daysSinceMonday);
  return dayStart.toISOString();
}

/**
 * Downsamples a daily, date-ascending series to one point per week/month
 * bucket, keeping the LAST (most recent) point in each bucket -- a
 * balance is a point-in-time snapshot, not something that sums
 * meaningfully across days, so "last value in the bucket" is the correct
 * downsample (unlike, say, cash flow, which sums). `"day"` returns the
 * series unchanged (a copy, not the same array reference).
 *
 * Assumes `points` is already sorted oldest-first, the order
 * useNetWorthQuery()/fillNetWorthSeries() already return it in (and the
 * order NetWorthChart.tsx already assumes for its own first/last
 * endpoint labels) -- this does not re-sort, so a caller handing it an
 * unsorted or descending series will get an unsorted or descending
 * result back, not a corrected one.
 */
export function downsampleNetWorthSeries(
  points: readonly NetWorthPoint[],
  granularity: BalanceGraphGranularity,
): NetWorthPoint[] {
  if (granularity === "day" || points.length === 0) return [...points];

  const bucketKeyFor = granularity === "week" ? weekBucketKey : monthBucketKey;
  const order: string[] = [];
  const lastByBucket = new Map<string, NetWorthPoint>();
  for (const point of points) {
    const key = bucketKeyFor(new Date(point.date));
    if (!lastByBucket.has(key)) order.push(key);
    // Later points overwrite earlier ones for the same bucket -- since
    // `points` is date-ascending, whatever is left standing after the
    // loop is the last (most recent) point in that bucket.
    lastByBucket.set(key, point);
  }
  return order.map((key) => lastByBucket.get(key)!);
}
