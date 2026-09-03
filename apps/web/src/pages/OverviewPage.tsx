// pages/OverviewPage.tsx — ANLY-13: replaces NetWorthPage.tsx as the
// app's home page (the `/` and unmatched-route redirects both point
// here now, router.tsx), absorbing CashFlowPage.tsx, AccountsPage.tsx,
// and SpendingPage.tsx wholesale -- all four are deleted by this same
// ticket. Layout top to bottom, per BACKLOG.md's own ordering: (1)
// Wallets (accounts-as-cards + the Plaid Link connect flow), (2) the
// stat row + balance graph (Days/Weeks/Months toggle), (3) the Cash Flow
// bar chart kept as a secondary section, (4) Period Income/Period
// Expenses donuts.
//
// Flagged judgment calls (none of these are spelled out in BACKLOG.md's
// ANLY-13 text -- also written into this ticket's own "Delivered" note):
// - No manual date-range picker anywhere on this page, unlike every
//   other analytics page this app has ever had -- every section uses a
//   fixed window instead (see the two below).
// - The balance graph and the Cash Flow chart both use
//   defaultAnalyticsRange() (trailing 6 months to today) -- the
//   Days/Weeks/Months toggle only changes how that same window is
//   bucketed, it doesn't widen or narrow it. One side effect: gap-dashing
//   (NetWorthChart's own coverage-gap indicator) is computed on whatever
//   series it's handed, so a short single-day gap can get smoothed over
//   once Weeks/Months downsampling is in effect -- an inherent, accepted
//   tradeoff of the client-side downsample BACKLOG.md itself suggested,
//   not a bug.
// - "Period" (the stat row's income/expenses, both donuts) means the
//   current UTC calendar month (currentCalendarMonthRange()) --
//   BACKLOG.md never names what "period" means for this new page. The
//   stat row's income/expenses figures are the *last* point in the same
//   6-month Cash Flow series the chart below it renders (that series is
//   always one point per calendar month, ending on the current month --
//   see fillMonthlyCashFlowSeries), rather than a second query scoped to
//   just this month, so the stat row and the chart's rightmost bar pair
//   never disagree.
// - The "compare to previous period" toggle every other analytics page
//   exposed is dropped here -- Overview never shows one; the donuts and
//   stat row are both single-period snapshots by design.
import { useMemo, useState } from "react";
import {
  useCashFlowQuery,
  useIncomeCategoriesQuery,
  useNetWorthQuery,
  useSpendingCategoriesQuery,
} from "../api/analytics";
import { CashFlowChart } from "../components/charts/CashFlowChart";
import { CategoryDonutChart } from "../components/charts/CategoryDonutChart";
import { NetWorthChart } from "../components/charts/NetWorthChart";
import { WalletsSection } from "../components/WalletsSection";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { currentCalendarMonthRange, defaultAnalyticsRange } from "../lib/dateRange";
import { formatCents } from "../lib/money";
import {
  BALANCE_GRAPH_GRANULARITIES,
  downsampleNetWorthSeries,
  type BalanceGraphGranularity,
} from "../lib/balanceGraphGranularity";

const GRANULARITY_LABEL: Record<BalanceGraphGranularity, string> = {
  day: "Days",
  week: "Weeks",
  month: "Months",
};

export default function OverviewPage() {
  const balanceRange = useMemo(() => defaultAnalyticsRange(), []);
  const periodRange = useMemo(() => currentCalendarMonthRange(), []);
  const [granularity, setGranularity] = useState<BalanceGraphGranularity>("day");

  const netWorth = useNetWorthQuery(balanceRange);
  const cashFlow = useCashFlowQuery(balanceRange);
  const expenseCategories = useSpendingCategoriesQuery(periodRange);
  const incomeCategories = useIncomeCategoriesQuery(periodRange);

  const latestNetWorth =
    netWorth.data && netWorth.data.length > 0 ? netWorth.data[netWorth.data.length - 1] : undefined;
  const latestCashFlow =
    cashFlow.data && cashFlow.data.current.length > 0
      ? cashFlow.data.current[cashFlow.data.current.length - 1]
      : undefined;

  const downsampled = useMemo(
    () => (netWorth.data ? downsampleNetWorthSeries(netWorth.data, granularity) : []),
    [netWorth.data, granularity],
  );

  return (
    <div className="flex flex-1 flex-col gap-8 p-8">
      <div>
        <h1 className="text-xl font-medium tracking-tight text-ink">Overview</h1>
        <p className="text-sm text-ink-secondary">Every linked account, at a glance.</p>
      </div>

      <WalletsSection />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4">
          <Stat
            label="Total balance"
            value={latestNetWorth ? formatCents(latestNetWorth.netWorth) : "—"}
          />
          <Stat
            label="Total period income"
            value={latestCashFlow ? formatCents(latestCashFlow.income) : "—"}
          />
          <Stat
            label="Total period expenses"
            value={latestCashFlow ? formatCents(latestCashFlow.expenses) : "—"}
          />
        </div>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Balance over time</CardTitle>
              <CardDescription>
                Dashed segments mark days before every currently-linked account existed.
              </CardDescription>
            </div>
            <div className="flex flex-shrink-0 gap-1">
              {BALANCE_GRAPH_GRANULARITIES.map((g) => (
                <Button
                  key={g}
                  type="button"
                  size="sm"
                  variant={granularity === g ? "default" : "outline"}
                  onClick={() => setGranularity(g)}
                >
                  {GRANULARITY_LABEL[g]}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {netWorth.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
            {netWorth.isError && (
              <p className="text-sm text-critical-text">
                Could not load balance history. Try again shortly.
              </p>
            )}
            {netWorth.data && netWorth.data.length === 0 && (
              <p className="text-sm text-ink-muted">No balance history yet.</p>
            )}
            {downsampled.length > 0 && <NetWorthChart points={downsampled} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Income vs. expenses</CardTitle>
            <CardDescription>One bar pair per calendar month, trailing six months.</CardDescription>
          </CardHeader>
          <CardContent>
            {cashFlow.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
            {cashFlow.isError && (
              <p className="text-sm text-critical-text">
                Could not load cash flow. Try again shortly.
              </p>
            )}
            {cashFlow.data && cashFlow.data.current.length === 0 && (
              <p className="text-sm text-ink-muted">No cash flow activity yet.</p>
            )}
            {cashFlow.data && cashFlow.data.current.length > 0 && (
              <CashFlowChart current={cashFlow.data.current} compare={cashFlow.data.compare} />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Period income</CardTitle>
            <CardDescription>By category, this calendar month.</CardDescription>
          </CardHeader>
          <CardContent>
            {incomeCategories.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
            {incomeCategories.isError && (
              <p className="text-sm text-critical-text">
                Could not load income. Try again shortly.
              </p>
            )}
            {incomeCategories.data && (
              <CategoryDonutChart
                items={incomeCategories.data.current}
                range={periodRange}
                emptyMessage="No income in this period yet."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Period expenses</CardTitle>
            <CardDescription>By category, this calendar month.</CardDescription>
          </CardHeader>
          <CardContent>
            {expenseCategories.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
            {expenseCategories.isError && (
              <p className="text-sm text-critical-text">
                Could not load spending. Try again shortly.
              </p>
            )}
            {expenseCategories.data && (
              <CategoryDonutChart
                items={expenseCategories.data.current}
                range={periodRange}
                emptyMessage="No spending in this period yet."
              />
            )}
          </CardContent>
        </Card>
      </section>
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
