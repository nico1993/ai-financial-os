// components/charts/NetWorthChart.tsx — ANLY-9/ANLY-11's net-worth line
// chart. Hand-rolled SVG rather than a charting library (none is a
// dependency of apps/web -- see ADR-0038): the dataviz skill's method is
// "build each [component] in plain HTML," and a single-series line chart
// with a hover crosshair is little enough SVG to not justify a new
// dependency in a solo-user app.
//
// Single series -> no legend box needed (the card title names it, per the
// dataviz skill's accessibility-pass rule). Color is the sequential hue
// from design/tokens.ts (ADR-0030); dashed vs. solid segments come from
// netWorthGaps.ts's ANLY-11 coverage-gap split, not from any data being
// literally missing.
import { useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { NetWorthPoint } from "../../api/analytics";
import { SEQUENTIAL_HUE, UI_COLOR } from "../../design/tokens";
import { formatDayLabel } from "../../lib/dateRange";
import { formatCents } from "../../lib/money";
import { flagPartialCoverage, toSegments } from "./netWorthGaps";

const WIDTH = 640;
const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 24, left: 16 };
const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;

interface NetWorthChartProps {
  points: NetWorthPoint[];
}

export function NetWorthChart({ points }: NetWorthChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const flagged = useMemo(() => flagPartialCoverage(points), [points]);
  const segments = useMemo(() => toSegments(flagged), [flagged]);

  const { minY, maxY } = useMemo(() => {
    if (flagged.length === 0) return { minY: 0, maxY: 0 };
    let min = flagged[0]!.netWorth;
    let max = flagged[0]!.netWorth;
    for (const p of flagged) {
      if (p.netWorth < min) min = p.netWorth;
      if (p.netWorth > max) max = p.netWorth;
    }
    if (min === max) {
      // A flat (or single-point) series still needs a non-zero span so
      // the line doesn't collapse onto one edge of the plot.
      min -= 100;
      max += 100;
    }
    const span = max - min;
    return { minY: min - span * 0.1, maxY: max + span * 0.1 };
  }, [flagged]);

  const n = flagged.length;

  function xAt(index: number): number {
    if (n <= 1) return PADDING.left + PLOT_WIDTH / 2;
    return PADDING.left + (index / (n - 1)) * PLOT_WIDTH;
  }

  function yAt(value: number): number {
    if (maxY === minY) return PADDING.top + PLOT_HEIGHT / 2;
    return PADDING.top + (1 - (value - minY) / (maxY - minY)) * PLOT_HEIGHT;
  }

  function pathFor(segmentPoints: { netWorth: number }[], startIndex: number): string {
    return segmentPoints
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(startIndex + i)} ${yAt(p.netWorth)}`)
      .join(" ");
  }

  const zeroLineY = minY <= 0 && maxY >= 0 ? yAt(0) : null;

  function handleMouseMove(event: ReactMouseEvent<HTMLDivElement>): void {
    if (n === 0 || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const ratio = (localX - PADDING.left) / PLOT_WIDTH;
    const index = Math.round(ratio * (n - 1));
    setHoverIndex(Math.min(n - 1, Math.max(0, index)));
  }

  const hovered = hoverIndex !== null ? flagged[hoverIndex] : undefined;
  const first = flagged[0];
  const last = flagged[n - 1];

  // Segment start indices, needed because pathFor() re-derives x from a
  // segment-local index but segments start partway through the series.
  let runningIndex = 0;
  const segmentStarts: number[] = segments.map((segment) => {
    const start = runningIndex;
    runningIndex += segment.points.length - 1; // last point is shared with the next segment
    return start;
  });

  return (
    <div>
      <div
        ref={containerRef}
        className="relative w-full select-none"
        style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-full w-full overflow-visible">
          {zeroLineY !== null && (
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={zeroLineY}
              y2={zeroLineY}
              stroke={UI_COLOR.border}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {segments.map((segment, i) => (
            <path
              key={i}
              d={pathFor(segment.points, segmentStarts[i]!)}
              fill="none"
              stroke={SEQUENTIAL_HUE}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={segment.isPartial ? "5 4" : undefined}
              opacity={segment.isPartial ? 0.55 : 1}
            />
          ))}

          {last && <circle cx={xAt(n - 1)} cy={yAt(last.netWorth)} r={3} fill={SEQUENTIAL_HUE} />}

          {hovered && hoverIndex !== null && (
            <g>
              <line
                x1={xAt(hoverIndex)}
                x2={xAt(hoverIndex)}
                y1={PADDING.top}
                y2={HEIGHT - PADDING.bottom}
                stroke={UI_COLOR.border}
                strokeWidth={1}
              />
              <circle
                cx={xAt(hoverIndex)}
                cy={yAt(hovered.netWorth)}
                r={4}
                fill={UI_COLOR.surface}
                stroke={SEQUENTIAL_HUE}
                strokeWidth={2}
              />
            </g>
          )}
        </svg>

        {first && last && (
          <div className="pointer-events-none absolute inset-x-4 bottom-0.5 flex justify-between text-[10px] text-ink-muted">
            <span>{formatDayLabel(first.date)}</span>
            <span>{formatDayLabel(last.date)}</span>
          </div>
        )}

        {hovered && hoverIndex !== null && (
          <div
            className="pointer-events-none absolute top-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-sm"
            style={{ left: `${(xAt(hoverIndex) / WIDTH) * 100}%` }}
          >
            <div className="font-medium text-ink">{formatCents(hovered.netWorth)}</div>
            <div className="text-ink-muted">{formatDayLabel(hovered.date)}</div>
            {hovered.isPartial && (
              <div className="mt-0.5 text-ink-muted">Not all accounts linked yet</div>
            )}
          </div>
        )}
      </div>

      <details className="mt-2 text-xs text-ink-secondary">
        <summary className="cursor-pointer select-none">View as table</summary>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-surface-secondary text-[11px] uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-2 py-1 font-medium">Date</th>
                <th className="px-2 py-1 font-medium">Net worth</th>
                <th className="px-2 py-1 font-medium">Coverage</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[11px] tabular-nums">
              {flagged.map((p) => (
                <tr key={p.date} className="border-t border-border">
                  <td className="px-2 py-1 font-sans">{formatDayLabel(p.date)}</td>
                  <td className="px-2 py-1">{formatCents(p.netWorth)}</td>
                  <td className="px-2 py-1 font-sans">{p.isPartial ? "Partial" : "Full"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
