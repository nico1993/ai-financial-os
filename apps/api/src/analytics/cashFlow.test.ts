import { describe, it, expect } from "vitest";
import { fillMonthlyCashFlowSeries, type MonthlyRollupSourceRow } from "./cashFlow.js";

describe("fillMonthlyCashFlowSeries", () => {
  it("returns an exact-match row for a month with its own rollup", () => {
    const rows: MonthlyRollupSourceRow[] = [
      { month: new Date("2026-01-01"), income: 200_000, expenses: 50_000 },
    ];
    const points = fillMonthlyCashFlowSeries(rows, {
      start: new Date("2026-01-01"),
      end: new Date("2026-01-31"),
    });
    expect(points).toEqual([
      { month: new Date("2026-01-01T00:00:00.000Z"), income: 200_000, expenses: 50_000 },
    ]);
  });

  it("fills a month with no rollup as a real $0/$0 -- not a gap, unlike net worth", () => {
    const points = fillMonthlyCashFlowSeries([], {
      start: new Date("2026-01-01"),
      end: new Date("2026-03-31"),
    });
    expect(points).toHaveLength(3);
    expect(points.every((p) => p.income === 0 && p.expenses === 0)).toBe(true);
    expect(points.map((p) => p.month.toISOString())).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    ]);
  });

  it("mixes real and filled months in the same range", () => {
    const rows: MonthlyRollupSourceRow[] = [
      { month: new Date("2026-02-01"), income: 1_000, expenses: 500 },
    ];
    const points = fillMonthlyCashFlowSeries(rows, {
      start: new Date("2026-01-01"),
      end: new Date("2026-03-31"),
    });
    expect(points.map((p) => ({ income: p.income, expenses: p.expenses }))).toEqual([
      { income: 0, expenses: 0 },
      { income: 1_000, expenses: 500 },
      { income: 0, expenses: 0 },
    ]);
  });

  it("normalizes a mid-month range boundary to whole months", () => {
    const points = fillMonthlyCashFlowSeries([], {
      start: new Date("2026-01-15"),
      end: new Date("2026-02-05"),
    });
    // Jan (containing the 15th) through Feb (containing the 5th).
    expect(points).toHaveLength(2);
  });
});
