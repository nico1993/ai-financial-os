import { describe, it, expect } from "vitest";
import { downsampleNetWorthSeries } from "./balanceGraphGranularity";
import type { NetWorthPoint } from "../api/analytics";

function point(date: string, netWorth = 0): NetWorthPoint {
  return { date, netWorth, assets: 0, liabilities: 0, accounts: [] };
}

describe("downsampleNetWorthSeries", () => {
  it("returns an empty series unchanged", () => {
    expect(downsampleNetWorthSeries([], "month")).toEqual([]);
  });

  it("'day' granularity returns every point, unchanged", () => {
    const points = [point("2026-01-01T00:00:00.000Z", 100), point("2026-01-02T00:00:00.000Z", 200)];
    expect(downsampleNetWorthSeries(points, "day")).toEqual(points);
  });

  it("'month' granularity keeps only the last point of each calendar month", () => {
    const points = [
      point("2026-01-05T00:00:00.000Z", 100),
      point("2026-01-20T00:00:00.000Z", 150), // last of January
      point("2026-02-01T00:00:00.000Z", 200),
      point("2026-02-15T00:00:00.000Z", 250), // last of February
    ];
    const result = downsampleNetWorthSeries(points, "month");
    expect(result.map((p) => p.netWorth)).toEqual([150, 250]);
  });

  it("does not re-sort -- bucket order follows the order buckets first appear in the input", () => {
    const points = [
      point("2026-03-10T00:00:00.000Z", 300),
      point("2026-01-10T00:00:00.000Z", 100),
      point("2026-02-10T00:00:00.000Z", 200),
    ];
    const result = downsampleNetWorthSeries(points, "month");
    expect(result.map((p) => p.netWorth)).toEqual([300, 100, 200]);
  });

  it("'week' granularity keeps only the last point of each Monday-starting week", () => {
    // 2026-01-05 is a Monday.
    const points = [
      point("2026-01-05T00:00:00.000Z", 10), // Mon, week 1
      point("2026-01-07T00:00:00.000Z", 20), // Wed, week 1 -- last of week 1
      point("2026-01-12T00:00:00.000Z", 30), // Mon, week 2 -- only point of week 2
    ];
    const result = downsampleNetWorthSeries(points, "week");
    expect(result.map((p) => p.netWorth)).toEqual([20, 30]);
  });

  it("a single point downsamples to itself under any granularity", () => {
    const points = [point("2026-06-15T00:00:00.000Z", 500)];
    expect(downsampleNetWorthSeries(points, "week").map((p) => p.netWorth)).toEqual([500]);
    expect(downsampleNetWorthSeries(points, "month").map((p) => p.netWorth)).toEqual([500]);
  });
});
