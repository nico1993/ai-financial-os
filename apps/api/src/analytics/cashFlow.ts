// cashFlow.ts — ANLY-4's pure month-gap-fill logic (ARCHITECTURE.md §4.2,
// ADR-0035), kept free of Fastify and Mongoose (§7.5), mirroring
// netWorth.ts's split between pure logic and the route
// (../routes/analytics.ts) that loads data and calls it.
export interface MonthlyRollupSourceRow {
  month: Date;
  income: number;
  expenses: number;
}

export type MonthlyCashFlowPoint = MonthlyRollupSourceRow;

export interface DateRange {
  start: Date;
  end: Date;
}

function utcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function utcMonthKey(date: Date): string {
  return utcMonthStart(date).toISOString();
}

function addOneUtcMonth(month: Date): Date {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
}

/**
 * Fills month-level gaps in the rollup series (ANLY-4, ADR-0035) — one row
 * per calendar month covering `range`, defaulting an untouched month to a
 * real `{income: 0, expenses: 0}` rather than omitting it. Unlike
 * netWorth.ts's carry-forward, a month with no MonthlyRollup row
 * genuinely had zero income/expense activity (ADR-0008 only writes a
 * bucket for a month that had transactions); there's no "unknown balance"
 * concept to carry forward the way a point-in-time net worth figure has.
 * `rows` need not be pre-sorted.
 */
export function fillMonthlyCashFlowSeries(
  rows: readonly MonthlyRollupSourceRow[],
  range: DateRange,
): MonthlyCashFlowPoint[] {
  const byMonth = new Map<string, MonthlyRollupSourceRow>();
  for (const row of rows) {
    byMonth.set(utcMonthKey(row.month), row);
  }

  const points: MonthlyCashFlowPoint[] = [];
  for (
    let month = utcMonthStart(range.start);
    month.getTime() <= range.end.getTime();
    month = addOneUtcMonth(month)
  ) {
    const existing = byMonth.get(utcMonthKey(month));
    points.push(existing ?? { month, income: 0, expenses: 0 });
  }

  return points;
}
