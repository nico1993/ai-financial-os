// components/charts/CashFlowChart.tsx — ANLY-9/ANLY-6's cash-flow chart:
// income vs. expenses per month as a grouped bar chart. Two named series
// -> categorical color, fixed order (dataviz non-negotiable), never the
// reserved status palette -- "income" and "expenses" are an identity
// distinction, not a good/bad judgment about spending.
//
// The ANLY-6 compare range is deliberately NOT overlaid as a third/fourth
// bar group on this chart (a grouped-of-grouped bar chart reads badly at
// this width for a solo dashboard) -- instead it drives the net-cash-flow
// summary below, which is where design/tokens.ts's STATUS_COLOR doc
// comment explicitly names its own use case ("cash-flow positive/
// negative"): net-for-the-period is a real state (surplus vs. deficit),
// where income-vs-expenses is not. See ADR-0038.
import { useMemo, useState } from "react";
import type { CashFlowPoint } from "../../api/analytics";
import { CATEGORICAL_PALETTE, STATUS_COLOR } from "../../design/tokens";
import { formatMonthLabel } from "../../lib/dateRange";
import { formatCents } from "../../lib/money";

const WIDTH = 640;
const HEIGHT = 220;
const PADDING = { top: 16, right: 8, bottom: 28, left: 8 };
const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;

const INCOME_COLOR = CATEGORICAL_PALETTE[0];
const EXPENSES_COLOR = CATEGORICAL_PALETTE[1];

interface CashFlowChartProps {
  current: CashFlowPoint[];
  compare: CashFlowPoint[] | null;
}

function sumNet(points: CashFlowPoint[]): number {
  return points.reduce((sum, p) => sum + p.income - p.expenses, 0);
}

export function CashFlowChart({ current, compare }: CashFlowChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const maxValue = useMemo(
    () => current.reduce((max, p) => Math.max(max, p.income, p.expenses), 0),
    [current],
  );

  const n = current.length;
  const bandWidth = n > 0 ? PLOT_WIDTH / n : PLOT_WIDTH;
  const barGap = 4;
  const barWidth = Math.max(4, (bandWidth * 0.7 - barGap) / 2);

  function heightFor(value: number): number {
    if (maxValue <= 0) return 0;
    return (value / maxValue) * PLOT_HEIGHT;
  }

  const currentNet = sumNet(current);
  const compareNet = compare ? sumNet(compare) : null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-ink-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: INCOME_COLOR }}
          />
          Income
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: EXPENSES_COLOR }}
          />
          Expenses
        </span>
      </div>

      <div className="relative w-full" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-full w-full overflow-visible">
          {current.map((p, i) => {
            const bandStart = PADDING.left + i * bandWidth;
            const incomeX = bandStart + bandWidth * 0.15;
            const expensesX = incomeX + barWidth + barGap;
            const incomeH = heightFor(p.income);
            const expensesH = heightFor(p.expenses);
            const baseline = HEIGHT - PADDING.bottom;
            return (
              <g
                key={p.month}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((prev) => (prev === i ? null : prev))}
              >
                <rect
                  x={bandStart}
                  y={PADDING.top}
                  width={bandWidth}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                />
                <rect
                  x={incomeX}
                  y={baseline - incomeH}
                  width={barWidth}
                  height={incomeH}
                  rx={2}
                  fill={INCOME_COLOR}
                  opacity={hoverIndex === null || hoverIndex === i ? 1 : 0.35}
                />
                <rect
                  x={expensesX}
                  y={baseline - expensesH}
                  width={barWidth}
                  height={expensesH}
                  rx={2}
                  fill={EXPENSES_COLOR}
                  opacity={hoverIndex === null || hoverIndex === i ? 1 : 0.35}
                />
              </g>
            );
          })}
        </svg>

        {current.map((p, i) => {
          const bandStart = PADDING.left + i * bandWidth;
          return (
            <div
              key={p.month}
              className="pointer-events-none absolute bottom-0.5 text-center text-[10px] text-ink-muted"
              style={{
                left: `${(bandStart / WIDTH) * 100}%`,
                width: `${(bandWidth / WIDTH) * 100}%`,
              }}
            >
              {n <= 12 && formatMonthLabel(p.month)}
            </div>
          );
        })}

        {hoverIndex !== null && current[hoverIndex] && (
          <div
            className="pointer-events-none absolute top-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: `${((PADDING.left + (hoverIndex + 0.5) * bandWidth) / WIDTH) * 100}%`,
            }}
          >
            <div className="font-medium text-ink">
              {formatMonthLabel(current[hoverIndex]!.month)}
            </div>
            <div style={{ color: INCOME_COLOR }}>
              Income {formatCents(current[hoverIndex]!.income)}
            </div>
            <div style={{ color: EXPENSES_COLOR }}>
              Expenses {formatCents(current[hoverIndex]!.expenses)}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <NetStat label="This period" net={currentNet} />
        {compareNet !== null && <NetStat label="Previous period" net={compareNet} />}
      </div>

      <details className="mt-2 text-xs text-ink-secondary">
        <summary className="cursor-pointer select-none">View as table</summary>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-surface-secondary text-[11px] uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-2 py-1 font-medium">Month</th>
                <th className="px-2 py-1 font-medium">Income</th>
                <th className="px-2 py-1 font-medium">Expenses</th>
                <th className="px-2 py-1 font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[11px] tabular-nums">
              {current.map((p) => (
                <tr key={p.month} className="border-t border-border">
                  <td className="px-2 py-1 font-sans">{formatMonthLabel(p.month)}</td>
                  <td className="px-2 py-1">{formatCents(p.income)}</td>
                  <td className="px-2 py-1">{formatCents(p.expenses)}</td>
                  <td className="px-2 py-1">{formatCents(p.income - p.expenses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function NetStat({ label, net }: { label: string; net: number }) {
  const positive = net >= 0;
  const status = positive ? STATUS_COLOR.good : STATUS_COLOR.critical;
  return (
    <div className="rounded-md px-3 py-2" style={{ backgroundColor: status.wash }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: status.text }}>
        {label} net
      </div>
      <div className="font-mono text-sm font-medium tabular-nums" style={{ color: status.text }}>
        {positive ? "+" : ""}
        {formatCents(net)}
      </div>
    </div>
  );
}
