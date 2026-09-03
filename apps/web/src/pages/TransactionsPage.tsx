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
//
// WEB-13 adds: (1) a new `account` filter dimension, read the same
// once-on-mount way as category/dateFrom/dateTo above -- ANLY-13's
// Wallet-card click-through (`/transactions?account=<id>`) is this
// param's one producer today. A plain native `<select>` rather than
// CategorySelect.tsx -- accounts have no icon/color to render, so the
// extra Radix machinery that component exists for doesn't apply here.
// Appended to WEB-10's existing filter row rather than touching any of
// its existing controls, per this ticket's own explicit instruction. (2)
// A stat row (Current Wallet Balance, Total Period Change, Total Period
// Expenses, Total Period Income -- this exact order per the ticket's own
// text) sourced from useAccountsQuery() (balance) and the new
// useTransactionTotalsQuery() (the other three, scoped to the same
// filters as the list below). (3) TransactionsTable.tsx swapped for the
// new TransactionsLedger.tsx (day-grouped, larger category-icon avatars)
// -- see that component's own file header for why this is a new
// component rather than a rewrite of the shared one.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTransactionsQuery, useTransactionTotalsQuery } from "../api/transactions";
import { useCategoriesQuery } from "../api/categories";
import { useAccountsQuery } from "../api/accounts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { TransactionsLedger } from "../components/TransactionsLedger";
import { Button } from "../components/ui/button";
import { DateRangeControls } from "../components/DateRangeControls";
import { currentCalendarMonthRange } from "../lib/dateRange";
import type { DateRangeValue } from "../lib/dateRange";
import { CategorySelect } from "../components/CategorySelect";
import type { CategorySelectOption } from "../components/CategorySelect";
import { accountDisplayName } from "../lib/accountDisplayName";
import { formatCents, formatSignedCents } from "../lib/money";

const PAGE_SIZE = 50;
const EMPTY_RANGE: DateRangeValue = { start: "", end: "" };

// CAT-15: "All categories" is a real, plain-text option with no
// icon/swatch (it isn't a Category row) -- CategorySelect's `icon`/
// `color` are simply left undefined for it, same as
// ReviewCategoryControl.tsx's "not currently listed" fallback option.
const ALL_CATEGORIES_OPTION: CategorySelectOption = { value: "", label: "All categories" };

export default function TransactionsPage() {
  // ANLY-14/WEB-13: read once, on mount -- a Link with query params
  // navigating here should pre-apply the filter, but this page doesn't
  // need to keep tracking the URL after that (see the file comment
  // above).
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [range, setRange] = useState<DateRangeValue>(() => ({
    start: searchParams.get("dateFrom") ?? "",
    end: searchParams.get("dateTo") ?? "",
  }));
  const [category, setCategory] = useState(() => searchParams.get("category") ?? "");
  const [account, setAccount] = useState(() => searchParams.get("account") ?? "");

  const categories = useCategoriesQuery();
  const accounts = useAccountsQuery();
  const query = useTransactionsQuery({
    page,
    pageSize: PAGE_SIZE,
    dateFrom: range.start || undefined,
    dateTo: range.end || undefined,
    category: category || undefined,
    account: account || undefined,
  });
  const totals = useTransactionTotalsQuery({
    dateFrom: range.start || undefined,
    dateTo: range.end || undefined,
    account: account || undefined,
  });

  function updateRange(next: DateRangeValue): void {
    setRange(next);
    setPage(1);
  }

  function updateCategory(next: string): void {
    setCategory(next);
    setPage(1);
  }

  function updateAccount(next: string): void {
    setAccount(next);
    setPage(1);
  }

  const hasActiveFilter = Boolean(range.start || range.end || category || account);

  function clearFilters(): void {
    setRange(EMPTY_RANGE);
    setCategory("");
    setAccount("");
    setPage(1);
  }

  // WEB-13: "Current Wallet Balance" when no account filter is applied --
  // the sum across every linked account. BACKLOG.md's own ticket text
  // flags this specific reading as an unconfirmed guess ("probably the
  // sum across all accounts, but confirm"), not a settled spec -- see
  // this ticket's own delivered note.
  const currentWalletBalance = useMemo(() => {
    if (!accounts.data) return undefined;
    if (account) {
      return accounts.data.find((a) => a.id === account)?.currentBalance;
    }
    return accounts.data.reduce((sum, a) => sum + a.currentBalance, 0);
  }, [accounts.data, account]);

  // "Total Period Change" = income - expenses for the same filtered
  // window -- the same net-cash-flow definition ANLY-13's Overview page
  // uses for its own period stat, not a balance-history delta (see
  // OverviewPage.tsx's file header for the full reasoning this carries
  // over).
  const periodChange =
    totals.data !== undefined ? totals.data.income - totals.data.expenses : undefined;

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-medium tracking-tight text-ink">Transactions</h1>
        <p className="text-sm text-ink-secondary">
          Every transaction across your linked accounts, most recent first.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <Stat
          label="Current wallet balance"
          value={currentWalletBalance !== undefined ? formatCents(currentWalletBalance) : "—"}
        />
        <Stat
          label="Total period change"
          value={periodChange !== undefined ? formatSignedCents(periodChange) : "—"}
        />
        <Stat
          label="Total period expenses"
          value={totals.data ? formatCents(totals.data.expenses) : "—"}
        />
        <Stat
          label="Total period income"
          value={totals.data ? formatCents(totals.data.income) : "—"}
        />
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
        {/* WEB-13: the one new filter dimension this ticket adds --
            WEB-10's filters above are otherwise untouched, per this
            ticket's own explicit instruction not to deviate on them. */}
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          Account
          <select
            value={account}
            onChange={(e) => updateAccount(e.target.value)}
            aria-label="Filter by account"
            className="h-8 rounded-md border border-border bg-surface-secondary px-2 text-xs text-ink focus-visible:border-ink focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
          >
            <option value="">All accounts</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {accountDisplayName(a)}
              </option>
            ))}
          </select>
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
              <TransactionsLedger items={query.data.items} categories={categories.data ?? []} />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="font-mono text-lg font-medium tabular-nums text-ink">{value}</div>
    </div>
  );
}
