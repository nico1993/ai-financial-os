// netWorth.ts — ANLY-3's pure day-gap-fill logic (ARCHITECTURE.md §4.2,
// ADR-0035), kept free of Fastify and Mongoose (§7.5). The route
// (../routes/analytics.ts) loads the sparse snapshot series via
// RollupRepository.getNetWorthSeries() and hands it here; everything
// below is a pure function over data the caller already loaded.
export interface NetWorthAccountBalance {
  accountId: string;
  balance: number;
}

export interface NetWorthSourceSnapshot {
  date: Date;
  netWorth: number;
  assets: number;
  liabilities: number;
  accounts: NetWorthAccountBalance[];
}

export type NetWorthDayPoint = NetWorthSourceSnapshot;

export interface DateRange {
  start: Date;
  end: Date;
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcDayKey(date: Date): string {
  return utcDayStart(date).toISOString();
}

function addOneUtcDay(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Fills day-level gaps in a sparse snapshot series (ANLY-3, ADR-0035): the
 * rollup job only writes a DailyBalanceSnapshot for a day that actually
 * had transaction activity (ADR-0008's "touched bucket" signal), so a
 * quiet day in the middle of the range would otherwise be a hole in the
 * chart even though nothing about that day's true net worth is unknown —
 * it's identical to the most recent prior day's. This carries that prior
 * day's (and, if needed, an even earlier day's from before the requested
 * range) values forward for every day with no snapshot of its own.
 *
 * Days before the FIRST snapshot that exists *anywhere in this user's
 * history* (not just within `range`) are a real gap, not filled — §4.2's
 * "the series starts at that account's first snapshot date rather than
 * implying a $0 balance before it existed." `snapshots` need not be
 * pre-sorted; this function establishes its own starting point by
 * scanning for the latest snapshot at or before `range.start`.
 */
export function fillNetWorthSeries(
  snapshots: readonly NetWorthSourceSnapshot[],
  range: DateRange,
): NetWorthDayPoint[] {
  const byDay = new Map<string, NetWorthSourceSnapshot>();
  for (const snapshot of snapshots) {
    byDay.set(utcDayKey(snapshot.date), snapshot);
  }

  const rangeStart = utcDayStart(range.start);

  // Seed the carry-forward value with the latest snapshot at or before the
  // range's first day, even if it falls outside `range` itself — a quiet
  // stretch whose last real change was before the visible window still has
  // a true answer for "what was net worth on day one."
  let carry: NetWorthSourceSnapshot | undefined;
  for (const snapshot of snapshots) {
    const day = utcDayStart(snapshot.date);
    if (day.getTime() > rangeStart.getTime()) continue;
    if (!carry || day.getTime() > utcDayStart(carry.date).getTime()) carry = snapshot;
  }

  const points: NetWorthDayPoint[] = [];
  for (let day = rangeStart; day.getTime() <= range.end.getTime(); day = addOneUtcDay(day)) {
    const exact = byDay.get(utcDayKey(day));
    if (exact) carry = exact;
    if (!carry) continue; // before this user's first-ever snapshot
    points.push({
      date: day,
      netWorth: carry.netWorth,
      assets: carry.assets,
      liabilities: carry.liabilities,
      accounts: carry.accounts,
    });
  }

  return points;
}
