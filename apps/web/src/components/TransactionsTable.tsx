// components/TransactionsTable.tsx — the row rendering WEB-8's ticket
// text calls out by name ("a real transaction-row component... the one
// design/tokens.ts's TAG_PALETTE doc comment already anticipated"),
// pulled out of TransactionsPage so CAT-7's review queue (BACKLOG.md:
// "reuse WEB-8's transaction-row component and list page, filtered to
// needs_review") has something concrete to import rather than a
// copy-pasted table.
//
// Deliberately dumb about fetching/paging -- TransactionsPage owns that,
// CAT-7's review queue owns its own fetch (status: "needs_review") and
// passes results through here the same way. NOT dumb about editing,
// though (CAT-12): every place this table renders benefits from the
// same "click any row to edit it" popup, so that control lives here
// rather than being threaded through as a second `renderRowAction`-style
// slot every caller would have to wire up identically. This used to be
// CAT-13's standalone inline merchant-rename stand-in (`MerchantCell`),
// folded into CAT-12's fuller TransactionEditDialog now that it exists,
// per CAT-13's own note that this was the plan all along -- one
// TransactionEditDialog instance is mounted once below, not one per
// row, and whichever row is clicked becomes its `transaction` prop.
import { useState } from "react";
import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import type { TransactionListItem } from "../api/transactions";
import { Badge } from "./ui/badge";
import { accountDisplayName } from "../lib/accountDisplayName";
import { formatAmountDisplay } from "../lib/money";
import { TransactionEditDialog } from "./TransactionEditDialog";

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
  // CAT-12: which row's popup is open, or null -- one TransactionEditDialog
  // instance below, pointed at whichever row was clicked, rather than one
  // per row.
  const [editingItem, setEditingItem] = useState<TransactionListItem | null>(null);

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
            <tr
              key={item.id}
              // CAT-12: "click any row" opens the edit popup. tabIndex/role/
              // onKeyDown make it keyboard-reachable too, not just a mouse
              // affordance -- the same bar the standalone MerchantCell button
              // this replaces already met.
              tabIndex={0}
              role="button"
              aria-label={`Edit transaction: ${item.merchantName}`}
              onClick={() => setEditingItem(item)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setEditingItem(item);
              }}
              className="group cursor-pointer border-t border-border hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
            >
              <td className="whitespace-nowrap px-2 py-2 text-ink-secondary">
                {DATE_FORMAT.format(new Date(item.date))}
              </td>
              <td className="px-2 py-2 text-ink">
                <span className="inline-flex items-center gap-1.5">
                  {item.merchantName}
                  {item.pending && (
                    <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                      Pending
                    </span>
                  )}
                  <Pencil
                    className="h-3 w-3 flex-shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden="true"
                  />
                </span>
              </td>
              <td className="px-2 py-2 text-ink-secondary">
                {/* ACCT-3: was hardcoded to institutionName, so renaming an
                    account (ACCT-1) never showed up here. */}
                {accountDisplayName(item.account)}
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
              {renderRowAction && (
                // CAT-12: this column's own control (ReviewCategoryControl's
                // one-click dropdown, on the review queue) needs to keep
                // working on its own terms -- stopped here so a click inside
                // it doesn't also bubble up and open the row's edit popup.
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  {renderRowAction(item)}
                </td>
              )}
              {/* WEB-9: Plaid's sign convention, not the intuitive one -- positive
                  amount = money leaving the account (an expense, red), negative =
                  money in (income/a credit, green). Same convention ANLY-5's
                  `amount > 0` spending filter and matching.ts's doc comment already
                  rely on -- getting this backwards here would contradict both. */}
              <td
                className={`whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums ${
                  item.amount > 0
                    ? "text-critical-text"
                    : item.amount < 0
                      ? "text-good-text"
                      : "text-ink"
                }`}
              >
                {formatAmountDisplay(item.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <TransactionEditDialog
        transaction={editingItem}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null);
        }}
      />
    </div>
  );
}
