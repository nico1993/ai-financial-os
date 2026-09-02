// pages/TransactionsPage.tsx — WEB-8: the general ledger. Every linked
// account's transactions, most recent first, offset-paginated
// (TransactionRepository.findPageForUser()) rather than loading a
// potentially-thousands-of-rows history in one response.
//
// WEB-10 adds the filter row below the header: a date range (reusing
// DateRangeControls.tsx, already built for the analytics pages) plus a
// "This month" shortcut, and a category <select> populated from
// useCategoriesQuery() (already used by ReviewCategoryControl.tsx).
// Unlike the analytics pages, an empty range here is a valid, meaningful
// state ("show everything," not "pick a default window") -- WEB-10's
// filters are additive on top of an already-useful unfiltered ledger.
//
// ANLY-14 makes this page a link target: the Spending page's category
// rows navigate here with `category`/`dateFrom`/`dateTo` query params
// set, and the filter state below is seeded from `useSearchParams()` on
// first render so that arrival pre-applies the filter instead of landing
// on the full unfiltered list. The reverse never happens -- this page
// doesn't write its own filter state back into the URL as the user
// changes it, since nothing else needs to observe it (a plain refresh
// losing an in-progress filter is an acceptable trade for not adding
// history-entry-per-keystroke noise).
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTransactionsQuery } from "../api/transactions";
import { useCategoriesQuery } from "../api/categories";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { TransactionsTable } from "../components/TransactionsTable";
import { Button } from "../components/ui/button";
import { DateRangeControls } from "../components/DateRangeControls";
import { currentCalendarMonthRange } from "../lib/dateRange";
import type { DateRangeValue } from "../lib/dateRange";
import { CategorySelect } from "../components/CategorySelect";
import type { CategorySelectOption } from "../components/CategorySelect";

const PAGE_SIZE = 50;
const EMPTY_RANGE: DateRangeValue = { start: "", end: "" };

// CAT-15: "All categories" is a real, plain-text option with no
// icon/swatch (it isn't a Category row) -- CategorySelect's `icon`/
// `color` are simply left undefined for it, same as
// ReviewCategoryControl.tsx's "not currently listed" fallback option.
const ALL_CATEGORIES_OPTION: CategorySelectOption = { value: "", label: "All categories" };

export default function TransactionsPage() {
  // ANLY-14: read once, on mount -- a Link with query params navigating
  // here should pre-apply the filter, but this page doesn't need to keep
  // tracking the URL after that (see the file comment above).
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [range, setRange] = useState<DateRangeValue>(() => ({
    start: searchParams.get("dateFrom") ?? "",
    end: searchParams.get("dateTo") ?? "",
  }));
  const [category, setCategory] = useState(() => searchParams.get("category") ?? "");

  const categories = useCategoriesQuery();
  const query = useTransactionsQuery({
    page,
    pageSize: PAGE_SIZE,
    dateFrom: range.start || undefined,
    dateTo: range.end || undefined,
    category: category || undefined,
  });

  function updateRange(next: DateRangeValue): void {
    setRange(next);
    setPage(1);
  }

  function updateCategory(next: string): void {
    setCategory(next);
    setPage(1);
  }

  const hasActiveFilter = Boolean(range.start || range.end || category);

  function clearFilters(): void {
    setRange(EMPTY_RANGE);
    setCategory("");
    setPage(1);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-medium tracking-tight text-ink">Transactions</h1>
        <p className="text-sm text-ink-secondary">
          Every transaction across your linked accounts, most recent first.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <DateRangeControls start={range.start} end={range.end} onChange={updateRange} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => updateRange(currentCalendarMonthRange())}
        >
          This month
        </Button>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          Category
          <CategorySelect
            value={category}
            onChange={updateCategory}
            ariaLabel="Filter by category"
            options={[
              ALL_CATEGORIES_OPTION,
              ...(categories.data ?? []).map((c) => ({
                value: c.name,
                label: c.name,
                icon: c.icon,
                color: c.color,
              })),
            ]}
          />
        </label>
        {hasActiveFilter && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All transactions</CardTitle>
          <CardDescription>{PAGE_SIZE} per page.</CardDescription>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-critical-text">
              Could not load transactions. Try again shortly.
            </p>
          )}
          {query.data && query.data.items.length === 0 && (
            <p className="text-sm text-ink-muted">
              {page === 1
                ? hasActiveFilter
                  ? "No transactions match these filters."
                  : "No transactions yet -- link an account to start syncing."
                : "No more transactions."}
            </p>
          )}
          {query.data && query.data.items.length > 0 && (
            <>
              <TransactionsTable items={query.data.items} />
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-ink-muted">Page {page}</span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!query.data.hasMore}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
