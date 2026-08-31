// components/charts/netWorthGaps.ts — ANLY-11's gap-rendering helper. The
// net-worth series (apps/api/src/analytics/netWorth.ts) already fills
// every day in range with a carried-forward value, so there's never a
// missing point to render -- the "gap" ANLY-11 renders is a *coverage*
// gap instead: a day where not all of the user's CURRENT accounts had
// been linked yet, so that day's balance is real but incomplete (adding a
// second account last month means every day before that only ever
// reflected the first one).
//
// Rather than a per-account multi-line breakdown (a lot of new chart
// surface for a Phase 1 dashboard), each day is flagged `isPartial` when
// its `accounts.length` is less than the maximum seen anywhere in the
// series, and NetWorthChart renders those days as a dashed segment, solid
// once full coverage starts. Pure and tested here independent of the
// chart component, for the same reason apps/api's netWorth.ts/cashFlow.ts
// are pure and tested independent of their route.
import type { NetWorthPoint } from "../../api/analytics";

export interface NetWorthPlotPoint extends NetWorthPoint {
  isPartial: boolean;
}

export function flagPartialCoverage(points: readonly NetWorthPoint[]): NetWorthPlotPoint[] {
  const maxAccounts = points.reduce((max, p) => Math.max(max, p.accounts.length), 0);
  return points.map((p) => ({ ...p, isPartial: p.accounts.length < maxAccounts }));
}

/** Splits a flagged series into contiguous same-coverage runs, each
 * tagged with whether it's a dashed (partial) or solid (full) run --
 * what NetWorthChart iterates to draw one `<path>` per run (SVG has no
 * per-segment dash pattern within a single path). Consecutive runs share
 * their boundary point so the drawn line has no visual break at the
 * seam. */
export interface NetWorthSegment {
  isPartial: boolean;
  points: NetWorthPlotPoint[];
}

export function toSegments(points: readonly NetWorthPlotPoint[]): NetWorthSegment[] {
  if (points.length === 0) return [];
  const segments: NetWorthSegment[] = [];
  let current: NetWorthSegment = { isPartial: points[0]!.isPartial, points: [points[0]!] };
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!;
    if (point.isPartial === current.isPartial) {
      current.points.push(point);
    } else {
      current.points.push(point); // shared boundary point, no visual gap
      segments.push(current);
      current = { isPartial: point.isPartial, points: [point] };
    }
  }
  segments.push(current);
  return segments;
}
