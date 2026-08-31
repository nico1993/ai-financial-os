import { useState } from "react";
import { useNetWorthQuery } from "../api/analytics";
import { DateRangeControls } from "../components/DateRangeControls";
import { NetWorthChart } from "../components/charts/NetWorthChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { defaultAnalyticsRange } from "../lib/dateRange";
import { formatCents } from "../lib/money";

// ANLY-3/ANLY-9/ANLY-11.
export default function NetWorthPage() {
  const [range, setRange] = useState(defaultAnalyticsRange);
  const query = useNetWorthQuery(range);

  const latest =
    query.data && query.data.length > 0 ? query.data[query.data.length - 1] : undefined;

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium tracking-tight text-ink">Net worth</h1>
          <p className="text-sm text-ink-secondary">Balance history across every linked account.</p>
        </div>
        <DateRangeControls start={range.start} end={range.end} onChange={setRange} />
      </div>

      {latest && (
        <div className="flex flex-wrap gap-4">
          <Stat label="Net worth" value={formatCents(latest.netWorth)} />
          <Stat label="Assets" value={formatCents(latest.assets)} />
          <Stat label="Liabilities" value={formatCents(latest.liabilities)} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Net worth over time</CardTitle>
          <CardDescription>
            Dashed segments mark days before every currently-linked account existed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-critical-text">
              Could not load net worth. Try again shortly.
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-ink-muted">No balance history yet for this range.</p>
          )}
          {query.data && query.data.length > 0 && <NetWorthChart points={query.data} />}
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
