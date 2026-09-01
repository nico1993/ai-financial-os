// components/TransactionsTable.tsx — the row rendering WEB-8's ticket
// text calls out by name ("a real transaction-row component... the one
// design/tokens.ts's TAG_PALETTE doc comment already anticipated"),
// pulled out of TransactionsPage so CAT-7's review queue (BACKLOG.md:
// "reuse WEB-8's transaction-row component and list page, filtered to
// needs_review") has something concrete to import rather than a
// copy-pasted table.
//
// Deliberately dumb: takes `items` and renders them, no query/pagination
// awareness of its own -- TransactionsPage owns fetching and paging,
// CAT-7's review queue is expected to own its own fetch (status:
// "needs_review") and pass the results through here the same way.
import type { ReactNode } from "react";
import type { TransactionListItem } from "../api/transactions";
import { Badge } from "./ui/badge";
import { formatCents } from "../lib/money";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export interface TransactionsTableProps {
  items: TransactionListItem[];
  /** Slots a column in after Category, before Amount -- CAT-7's
   * category-correction control lands here later without this component
   * needing to change shape again. Omitted entirely (no header, no
   * cells) when not provided, which is WEB-8's own plain ledger view. */
  renderRowAction?: (item: TransactionListItem) => ReactNode;
}

export function TransactionsTable({ items, renderRowAction }: TransactionsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-2 py-1.5 font-medium">Date</th>
            <th className="px-2 py-1.5 font-medium">Merchant</th>
            <th className="px-2 py-1.5 font-medium">Account</th>
            <th className="px-2 py-1.5 font-medium">Category</th>
            {renderRowAction && <th className="px-2 py-1.5 font-medium" />}
            <th className="px-2 py-1.5 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-border">
              <td className="whitespace-nowrap px-2 py-2 text-ink-secondary">
                {DATE_FORMAT.format(new Date(item.date))}
              </td>
              <td className="px-2 py-2 text-ink">
                {item.merchantName}
                {item.pending && (
                  <span className="ml-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                    Pending
                  </span>
                )}
              </td>
              <td className="px-2 py-2 text-ink-secondary">
                {item.account.institutionName}
                {item.account.subtype && (
                  <span className="text-ink-muted"> · {item.account.subtype}</span>
                )}
              </td>
              <td className="px-2 py-2">
                <span className="text-ink-secondary">{item.category.value}</span>
                {item.category.status === "needs_review" && (
                  <Badge variant="status-warning" className="ml-2">
                    Needs review
                  </Badge>
                )}
              </td>
              {renderRowAction && <td className="px-2 py-2">{renderRowAction(item)}</td>}
              <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums text-ink">
                {formatCents(item.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
