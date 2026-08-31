import { useMemo, useState } from "react";
import { useCashFlowQuery } from "../api/analytics";
import { DateRangeControls } from "../components/DateRangeControls";
import { CashFlowChart } from "../components/charts/CashFlowChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { defaultAnalyticsRange, previousPeriodRange } from "../lib/dateRange";

// ANLY-4/ANLY-6/ANLY-9.
export default function CashFlowPage() {
  const [range, setRange] = useState(defaultAnalyticsRange);
  const [compareEnabled, setCompareEnabled] = useState(false);

  const compareRange = useMemo(
    () => (compareEnabled ? previousPeriodRange(range) : null),
    [compareEnabled, range],
  );

  const query = useCashFlowQuery({
    ...range,
    compareStart: compareRange?.start,
    compareEnd: compareRange?.end,
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium tracking-tight text-ink">Cash flow</h1>
          <p className="text-sm text-ink-secondary">
            Monthly income vs. expenses, transfers excluded.
          </p>
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
          <CardTitle>Income vs. expenses</CardTitle>
          <CardDescription>One bar pair per calendar month.</CardDescription>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-critical-text">
              Could not load cash flow. Try again shortly.
            </p>
          )}
          {query.data && query.data.current.length === 0 && (
            <p className="text-sm text-ink-muted">No cash flow activity yet for this range.</p>
          )}
          {query.data && query.data.current.length > 0 && (
            <CashFlowChart current={query.data.current} compare={query.data.compare} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
