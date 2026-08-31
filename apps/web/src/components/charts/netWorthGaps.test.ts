import { describe, it, expect } from "vitest";
import { flagPartialCoverage, toSegments } from "./netWorthGaps";
import type { NetWorthPoint } from "../../api/analytics";

function point(overrides: Partial<NetWorthPoint> = {}): NetWorthPoint {
  return {
    date: "2026-01-01T00:00:00.000Z",
    netWorth: 0,
    assets: 0,
    liabilities: 0,
    accounts: [],
    ...overrides,
  };
}

describe("flagPartialCoverage", () => {
  it("flags no day partial when every day already has the max account count", () => {
    const points = [
      point({ accounts: [{ accountId: "a", balance: 100 }] }),
      point({ accounts: [{ accountId: "a", balance: 200 }] }),
    ];
    const flagged = flagPartialCoverage(points);
    expect(flagged.every((p) => !p.isPartial)).toBe(true);
  });

  it("flags days with fewer accounts than the series-wide max", () => {
    const points = [
      point({ accounts: [{ accountId: "a", balance: 100 }] }),
      point({
        accounts: [
          { accountId: "a", balance: 100 },
          { accountId: "b", balance: 50 },
        ],
      }),
    ];
    const [first, second] = flagPartialCoverage(points);
    expect(first?.isPartial).toBe(true);
    expect(second?.isPartial).toBe(false);
  });

  it("treats an empty series as having no partial days", () => {
    expect(flagPartialCoverage([])).toEqual([]);
  });
});

describe("toSegments", () => {
  it("returns one segment for an all-solid series", () => {
    const flagged = flagPartialCoverage([point(), point()]);
    const segments = toSegments(flagged);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.isPartial).toBe(false);
    expect(segments[0]?.points).toHaveLength(2);
  });

  it("splits into dashed-then-solid runs sharing a boundary point", () => {
    const points: NetWorthPoint[] = [
      point({ date: "2026-01-01T00:00:00.000Z", accounts: [{ accountId: "a", balance: 1 }] }),
      point({ date: "2026-01-02T00:00:00.000Z", accounts: [{ accountId: "a", balance: 1 }] }),
      point({
        date: "2026-01-03T00:00:00.000Z",
        accounts: [
          { accountId: "a", balance: 1 },
          { accountId: "b", balance: 1 },
        ],
      }),
      point({
        date: "2026-01-04T00:00:00.000Z",
        accounts: [
          { accountId: "a", balance: 1 },
          { accountId: "b", balance: 1 },
        ],
      }),
    ];
    const segments = toSegments(flagPartialCoverage(points));
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ isPartial: true });
    expect(segments[0]?.points.map((p) => p.date)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    ]);
    expect(segments[1]).toMatchObject({ isPartial: false });
    expect(segments[1]?.points.map((p) => p.date)).toEqual([
      "2026-01-03T00:00:00.000Z",
      "2026-01-04T00:00:00.000Z",
    ]);
  });

  it("returns an empty array for an empty series", () => {
    expect(toSegments([])).toEqual([]);
  });
});
