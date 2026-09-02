// components/charts/SpendingCategoriesChart.tsx — ANLY-9/ANLY-5/ANLY-6's
// category breakdown: a ranked horizontal bar list, one row per category
// (already sorted desc by total -- TransactionRepository.getCategoryDistribution's
// own $sort), colored from CATEGORICAL_PALETTE in FIXED rank order.
//
// TransactionRepository's aggregation groups by `category.value` only
// (packages/db/src/repositories/TransactionRepository.ts) -- it does not
// join the Category collection for its stored `color` field, so unlike
// the transaction-row badges elsewhere in this app (design/tokens.ts's
// own doc comment), this chart cannot "read Category.color from the
// API." Assigning the validated categorical palette by rank instead is
// the dataviz-skill-compliant choice: fixed hue order, never cycled, and
// a 9th-and-beyond category folds into "Other" (CATEGORICAL_PALETTE has
// 8 slots) rather than generating a new hue. See ADR-0038.
//
// A ranked bar list IS its own accessible table (label + value on every
// row already, no color-only encoding), so this doesn't duplicate a
// hidden <table> the way the line/bar charts do.
//
// ANLY-14: every row except "Other" links to `/transactions`, filtered
// to that category over this same date range (WEB-10's filter, which
// this depends on). "Other" is excluded from the click affordance --
// BACKLOG.md's own open question, resolved here as the simplest safe
// default: it folds together every category past the palette's 8 slots
// (buildRows() below), so there is no single `category.value` to filter
// by. The alternative (a multi-value filter WEB-10 would need to grow to
// support) was considered and set aside rather than building filter
// surface a real product decision hasn't asked for yet.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { CategoryDistributionItem } from "../../api/analytics";
import { CATEGORICAL_PALETTE, UI_COLOR } from "../../design/tokens";
import { formatCents } from "../../lib/money";
import type { DateRangeValue } from "../../lib/dateRange";

interface CategoryRow {
  category: string;
  total: number;
  color: string | null; // null for the folded "Other" bucket
  compareTotal: number | null; // null when no compare range was requested
}

function buildRows(
  current: CategoryDistributionItem[],
  compare: CategoryDistributionItem[] | null,
): CategoryRow[] {
  const top = current.slice(0, CATEGORICAL_PALETTE.length);
  const overflow = current.slice(CATEGORICAL_PALETTE.length);
  const compareByCategory = new Map((compare ?? []).map((c) => [c.category, c.total]));
  const topNames = new Set(top.map((c) => c.category));

  const rows: CategoryRow[] = top.map((c, i) => ({
    category: c.category,
    total: c.total,
    color: CATEGORICAL_PALETTE[i]!,
    compareTotal: compare ? (compareByCategory.get(c.category) ?? 0) : null,
  }));

  if (overflow.length > 0) {
    const otherTotal = overflow.reduce((sum, c) => sum + c.total, 0);
    const compareOtherTotal = compare
      ? compare.filter((c) => !topNames.has(c.category)).reduce((sum, c) => sum + c.total, 0)
      : null;
    rows.push({
      category: "Other",
      total: otherTotal,
      color: null,
      compareTotal: compareOtherTotal,
    });
  }

  return rows;
}

interface SpendingCategoriesChartProps {
  current: CategoryDistributionItem[];
  compare: CategoryDistributionItem[] | null;
  /** ANLY-14: the Spending page's currently-selected date range --
   * carried into each row's `/transactions` link so the drill-down opens
   * scoped to the same window this chart is showing, not the ledger's
   * own unfiltered default. */
  range: DateRangeValue;
}

/** ANLY-14: `/transactions?category=<value>&dateFrom=<start>&dateTo=<end>`
 * -- the exact param names WEB-10's TransactionsPage.tsx reads on mount. */
function transactionsLinkFor(category: string, range: DateRangeValue): string {
  const params = new URLSearchParams({
    category,
    dateFrom: range.start,
    dateTo: range.end,
  });
  return `/transactions?${params.toString()}`;
}

export function SpendingCategoriesChart({ current, compare, range }: SpendingCategoriesChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const rows = useMemo(() => buildRows(current, compare), [current, compare]);
  const maxTotal = useMemo(() => rows.reduce((max, r) => Math.max(max, r.total), 0), [rows]);

  if (rows.length === 0) {
    return <p className="text-sm text-ink-muted">No categorized spending in this range.</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const widthPct = maxTotal > 0 ? (row.total / maxTotal) * 100 : 0;
        const delta = row.compareTotal === null ? null : row.total - row.compareTotal;

        const rowContent = (
          <>
            <div className="w-32 flex-shrink-0 truncate text-xs text-ink-secondary">
              {row.category}
            </div>
            <div className="relative h-5 flex-1 rounded-sm bg-surface-secondary">
              <div
                className="h-full rounded-sm transition-[width]"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: row.color ?? UI_COLOR.inkMuted,
                  opacity: hovered === null || hovered === row.category ? 1 : 0.5,
                }}
              />
            </div>
            <div className="w-20 flex-shrink-0 text-right font-mono text-xs tabular-nums text-ink">
              {formatCents(row.total)}
            </div>
            {delta !== null && (
              <div className="w-24 flex-shrink-0 text-right text-[11px] text-ink-muted">
                {delta === 0 ? (
                  "no change"
                ) : (
                  <>
                    {delta > 0 ? "▲" : "▼"} {formatCents(Math.abs(delta))}
                  </>
                )}
              </div>
            )}
          </>
        );

        const rowHandlers = {
          onMouseEnter: () => setHovered(row.category),
          onMouseLeave: () =>
            setHovered((prev: string | null) => (prev === row.category ? null : prev)),
        };

        // "Other" (row.color === null) has no single category to filter
        // by -- see the file comment above -- so it renders as a plain,
        // non-interactive row instead of a link.
        if (row.color === null) {
          return (
            <div key={row.category} className="flex items-center gap-3" {...rowHandlers}>
              {rowContent}
            </div>
          );
        }

        return (
          <Link
            key={row.category}
            to={transactionsLinkFor(row.category, range)}
            className="flex items-center gap-3 rounded-sm hover:bg-surface-secondary"
            {...rowHandlers}
          >
            {rowContent}
          </Link>
        );
      })}
    </div>
  );
}
