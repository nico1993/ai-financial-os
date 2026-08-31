import { describe, it, expect } from "vitest";
import { fillNetWorthSeries, type NetWorthSourceSnapshot } from "./netWorth.js";

function snapshot(overrides: Partial<NetWorthSourceSnapshot> = {}): NetWorthSourceSnapshot {
  return {
    date: new Date("2026-01-10T00:00:00.000Z"),
    netWorth: 1_000,
    assets: 1_000,
    liabilities: 0,
    accounts: [{ accountId: "acct-1", balance: 1_000 }],
    ...overrides,
  };
}

describe("fillNetWorthSeries", () => {
  it("returns an exact-match point for a day with its own snapshot", () => {
    const points = fillNetWorthSeries([snapshot()], {
      start: new Date("2026-01-10"),
      end: new Date("2026-01-10"),
    });
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({
      date: new Date("2026-01-10T00:00:00.000Z"),
      netWorth: 1_000,
      assets: 1_000,
      liabilities: 0,
      accounts: [{ accountId: "acct-1", balance: 1_000 }],
    });
  });

  it("carries the last known snapshot forward through quiet days with no activity", () => {
    const points = fillNetWorthSeries([snapshot({ date: new Date("2026-01-10"), netWorth: 500 })], {
      start: new Date("2026-01-10"),
      end: new Date("2026-01-13"),
    });
    expect(points).toHaveLength(4);
    expect(points.map((p) => p.netWorth)).toEqual([500, 500, 500, 500]);
    expect(points.map((p) => p.date.toISOString().slice(0, 10))).toEqual([
      "2026-01-10",
      "2026-01-11",
      "2026-01-12",
      "2026-01-13",
    ]);
  });

  it("switches to a new snapshot's values exactly on the day it lands", () => {
    const points = fillNetWorthSeries(
      [
        snapshot({ date: new Date("2026-01-10"), netWorth: 500 }),
        snapshot({ date: new Date("2026-01-12"), netWorth: 900 }),
      ],
      { start: new Date("2026-01-10"), end: new Date("2026-01-13") },
    );
    expect(points.map((p) => p.netWorth)).toEqual([500, 500, 900, 900]);
  });

  it("omits days before the first available snapshot -- a real gap, not a synthetic $0", () => {
    const points = fillNetWorthSeries([snapshot({ date: new Date("2026-01-12"), netWorth: 900 })], {
      start: new Date("2026-01-10"),
      end: new Date("2026-01-13"),
    });
    expect(points.map((p) => p.date.toISOString().slice(0, 10))).toEqual([
      "2026-01-12",
      "2026-01-13",
    ]);
    expect(points.every((p) => p.netWorth === 900)).toBe(true);
  });

  it("returns an empty series when there are no snapshots at all yet", () => {
    const points = fillNetWorthSeries([], {
      start: new Date("2026-01-01"),
      end: new Date("2026-01-31"),
    });
    expect(points).toEqual([]);
  });

  it("carries an account's per-day balance forward along with the aggregate totals", () => {
    const points = fillNetWorthSeries(
      [
        snapshot({
          date: new Date("2026-01-10"),
          accounts: [
            { accountId: "checking", balance: 1_000 },
            { accountId: "savings", balance: 5_000 },
          ],
        }),
      ],
      { start: new Date("2026-01-10"), end: new Date("2026-01-11") },
    );
    expect(points[1]?.accounts).toEqual([
      { accountId: "checking", balance: 1_000 },
      { accountId: "savings", balance: 5_000 },
    ]);
  });

  it("ignores snapshots outside the requested range", () => {
    const points = fillNetWorthSeries(
      [
        snapshot({ date: new Date("2025-12-01"), netWorth: 1 }),
        snapshot({ date: new Date("2026-01-15"), netWorth: 2 }),
        snapshot({ date: new Date("2026-03-01"), netWorth: 3 }),
      ],
      { start: new Date("2026-01-01"), end: new Date("2026-01-31") },
    );
    expect(points).toHaveLength(31);
    // The Dec 1 snapshot still carries forward into January (it's the most
    // recent one as of Jan 1st), the March one is simply never reached.
    expect(points[0]?.netWorth).toBe(1);
    expect(points[14]?.netWorth).toBe(2); // Jan 15th, index 14
    expect(points[30]?.netWorth).toBe(2); // Jan 31st, still carrying Jan 15th
  });
});
