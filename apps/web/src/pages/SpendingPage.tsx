import { useMemo, useState } from "react";
import { useSpendingCategoriesQuery } from "../api/analytics";
import { DateRangeControls } from "../components/DateRangeControls";
import { SpendingCategoriesChart } from "../components/charts/SpendingCategoriesChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { defaultAnalyticsRange, previousPeriodRange } from "../lib/dateRange";

// ANLY-5/ANLY-6/ANLY-9. ANLY-14: `range` (this page's own selected
// date window) is threaded through to SpendingCategoriesChart so its
// row links carry the same window into the Transactions drill-down.
export default function SpendingPage() {
  const [range, setRange] = useState(defaultAnalyticsRange);
  const [compareEnabled, setCompareEnabled] = useState(false);

  const compareRange = useMemo(
    () => (compareEnabled ? previousPeriodRange(range) : null),
    [compareEnabled, range],
  );

  const query = useSpendingCategoriesQuery({
    ...range,
    compareStart: compareRange?.start,
    compareEnd: compareRange?.end,
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium tracking-tight text-ink">Spending</h1>
          <p className="text-sm text-ink-secondary">Category breakdown for the selected range.</p>
        </div>
        <DateRangeControls
          start={range.start}
          end={range.end}
          onChange={setRange}
          compareEnabled={compareEnabled}
          onCompareToggle={setCompareEnabled}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By category</CardTitle>
          <CardDescription>Ranked by total spent, highest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-critical-text">
              Could not load spending. Try again shortly.
            </p>
          )}
          {query.data && (
            <SpendingCategoriesChart
              current={query.data.current}
              compare={query.data.compare}
              range={range}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
