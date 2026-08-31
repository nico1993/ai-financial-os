import { useSubscriptionsQuery } from "../api/analytics";
import type { SubscriptionFrequency } from "../api/analytics";
import { Badge } from "../components/ui/badge";
import type { BadgeProps } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { formatCents } from "../lib/money";

const FREQUENCY_BADGE: Record<SubscriptionFrequency, NonNullable<BadgeProps["variant"]>> = {
  monthly: "tag-blue",
  annual: "tag-green",
  other: "tag-yellow",
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

// ANLY-7's read side/ANLY-9.
export default function SubscriptionsPage() {
  const query = useSubscriptionsQuery();

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-medium tracking-tight text-ink">Subscriptions</h1>
        <p className="text-sm text-ink-secondary">
          Recurring charges detected from transaction history.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active subscriptions</CardTitle>
          <CardDescription>
            Detected nightly from at least 3 similarly-timed, similarly-sized charges from the same
            merchant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
          {query.isError && (
            <p className="text-sm text-critical-text">
              Could not load subscriptions. Try again shortly.
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-ink-muted">No recurring charges detected yet.</p>
          )}
          {query.data && query.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Merchant</th>
                    <th className="px-2 py-1.5 font-medium">Amount</th>
                    <th className="px-2 py-1.5 font-medium">Frequency</th>
                    <th className="px-2 py-1.5 font-medium">Last charged</th>
                    <th className="px-2 py-1.5 font-medium">Next expected</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="px-2 py-2 text-ink">{s.merchantName}</td>
                      <td className="px-2 py-2 font-mono tabular-nums text-ink">
                        {formatCents(s.amount)}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={FREQUENCY_BADGE[s.frequency]}>{s.frequency}</Badge>
                      </td>
                      <td className="px-2 py-2 text-ink-secondary">
                        {DATE_FORMAT.format(new Date(s.lastTransactionDate))}
                      </td>
                      <td className="px-2 py-2 text-ink-secondary">
                        {DATE_FORMAT.format(new Date(s.nextExpectedDate))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
