// components/charts/CategoryDonutChart.tsx — ANLY-13's "Period Income"/
// "Period Expenses" donuts on the Overview page, replacing
// SpendingCategoriesChart.tsx's ranked-bar-list visualization wholesale
// (per BACKLOG.md's own ANLY-13 text) -- one component, used twice (once
// over TransactionRepository.getCategoryDistribution() for expenses, once
// over the new getIncomeCategoryDistribution() for income), since both
// are the exact same shape (CategoryDistributionItem[], already sorted
// desc) and need the exact same rendering.
//
// Hand-rolled SVG, not a charting library (ADR-0038, no such dependency
// in apps/web) -- a single ring is drawn as one stroked <circle> per
// category, using stroke-dasharray/stroke-dashoffset to carve out each
// slice's arc (the standard SVG-donut-without-path-trig technique),
// rotated -90deg so the first slice starts at 12 o'clock and slices
// proceed clockwise, matching how a clock/pie reads.
//
// Same categorical-palette-by-fixed-rank-order and "9th+ category folds
// into Other" rule SpendingCategoriesChart.tsx used (CATEGORICAL_PALETTE
// has 8 slots; TransactionRepository's aggregation groups by
// category.value only, so this can't read Category.color from the API
// either -- see that file's own retired comment for the full reasoning,
// still accurate here). "Other" has no single category to filter by, so
// it renders in the legend but isn't a link, same as before.
//
// No hidden <details> table fallback (unlike NetWorthChart/CashFlowChart)
// -- the legend list below the ring already shows label + amount on every
// row with no color-only encoding, so it IS its own accessible table,
// the same reasoning SpendingCategoriesChart.tsx's own retired comment
// gave for skipping one.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { CategoryDistributionItem } from "../../api/analytics";
import { CATEGORICAL_PALETTE, UI_COLOR } from "../../design/tokens";
import { formatCents } from "../../lib/money";
import type { DateRangeValue } from "../../lib/dateRange";

const SIZE = 160;
const CENTER = SIZE / 2;
const RADIUS = 56;
const STROKE_WIDTH = 24;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface CategoryRow {
  category: string;
  total: number;
  color: string | null; // null for the folded "Other" bucket
}

function buildRows(items: readonly CategoryDistributionItem[]): CategoryRow[] {
  const top = items.slice(0, CATEGORICAL_PALETTE.length);
  const overflow = items.slice(CATEGORICAL_PALETTE.length);

  const rows: CategoryRow[] = top.map((item, i) => ({
    category: item.category,
    total: item.total,
    color: CATEGORICAL_PALETTE[i]!,
  }));

  if (overflow.length > 0) {
    rows.push({
      category: "Other",
      total: overflow.reduce((sum, item) => sum + item.total, 0),
      color: null,
    });
  }

  return rows;
}

/** ANLY-14: `/transactions?category=<value>&dateFrom=<start>&dateTo=<end>`
 * -- the exact param names WEB-10's TransactionsPage.tsx reads on mount,
 * carried over unchanged from SpendingCategoriesChart.tsx's own retired
 * version of this same link. */
function transactionsLinkFor(category: string, range: DateRangeValue): string {
  const params = new URLSearchParams({
    category,
    dateFrom: range.start,
    dateTo: range.end,
  });
  return `/transactions?${params.toString()}`;
}

export interface CategoryDonutChartProps {
  items: CategoryDistributionItem[];
  /** ANLY-14: carried into each row's `/transactions` link so the
   * drill-down opens scoped to the same window this chart is showing. */
  range: DateRangeValue;
  /** Shown in place of the ring when `items` is empty -- "No spending in
   * this period yet" vs. "No income in this period yet", the two call
   * sites want different wording for the same empty state. */
  emptyMessage: string;
}

export function CategoryDonutChart({ items, range, emptyMessage }: CategoryDonutChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const rows = useMemo(() => buildRows(items), [items]);
  const grandTotal = useMemo(() => rows.reduce((sum, row) => sum + row.total, 0), [rows]);

  if (rows.length === 0 || grandTotal === 0) {
    return <p className="text-sm text-ink-muted">{emptyMessage}</p>;
  }

  // Cumulative arc-length offsets, one per row, so each slice's
  // stroke-dasharray/-dashoffset picks up exactly where the previous
  // slice's arc ended.
  let cumulative = 0;
  const arcs = rows.map((row) => {
    const fraction = row.total / grandTotal;
    const length = fraction * CIRCUMFERENCE;
    const arc = { row, fraction, dashOffset: -cumulative, length };
    cumulative += length;
    return arc;
  });

  const centerRow = hovered ? rows.find((r) => r.category === hovered) : undefined;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
          <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={UI_COLOR.border}
              strokeWidth={STROKE_WIDTH}
            />
            {arcs.map(({ row, length, dashOffset }) => (
              <circle
                key={row.category}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={row.color ?? UI_COLOR.inkMuted}
                strokeWidth={STROKE_WIDTH}
                strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                strokeDashoffset={dashOffset}
                opacity={hovered === null || hovered === row.category ? 1 : 0.35}
                onMouseEnter={() => setHovered(row.category)}
                onMouseLeave={() => setHovered((prev) => (prev === row.category ? null : prev))}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-mono text-sm font-medium tabular-nums text-ink">
            {formatCents(centerRow ? centerRow.total : grandTotal)}
          </div>
          <div className="max-w-[80px] truncate text-[10px] text-ink-muted">
            {centerRow ? centerRow.category : "Total"}
          </div>
        </div>
      </div>

      <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
        {rows.map((row) => {
          const pct = grandTotal > 0 ? Math.round((row.total / grandTotal) * 100) : 0;
          const rowHandlers = {
            onMouseEnter: () => setHovered(row.category),
            onMouseLeave: () => setHovered((prev) => (prev === row.category ? null : prev)),
          };
          const content = (
            <>
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: row.color ?? UI_COLOR.inkMuted }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary">
                {row.category}
              </span>
              <span className="flex-shrink-0 font-mono text-xs tabular-nums text-ink">
                {formatCents(row.total)}
              </span>
              <span className="w-9 flex-shrink-0 text-right text-[11px] text-ink-muted">
                {pct}%
              </span>
            </>
          );

          // "Other" (row.color === null) has no single category to filter
          // by -- see the file comment above -- so it renders as a plain,
          // non-interactive row instead of a link.
          if (row.color === null) {
            return (
              <div
                key={row.category}
                className="flex items-center gap-2 rounded-sm px-1 py-0.5"
                style={{ opacity: hovered === null || hovered === row.category ? 1 : 0.5 }}
                {...rowHandlers}
              >
                {content}
              </div>
            );
          }

          return (
            <Link
              key={row.category}
              to={transactionsLinkFor(row.category, range)}
              className="flex items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-surface-secondary"
              style={{ opacity: hovered === null || hovered === row.category ? 1 : 0.5 }}
              {...rowHandlers}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
