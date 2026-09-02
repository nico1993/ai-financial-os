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
// passes results through here the same way. NOT dumb about merchant-name
// editing, though (CAT-13): every place this table renders benefits from
// being able to rename a merchant inline, so that control lives here
// rather than being threaded through as a second `renderRowAction`-style
// slot every caller would have to wire up identically. CAT-12's future
// edit popup is expected to fold this back into a single "click the row"
// affordance -- this is the standalone stand-in until that lands.
import { useState } from "react";
import type { ReactNode } from "react";
import type { TransactionListItem } from "../api/transactions";
import { useSetMerchantNameOverrideMutation } from "../api/transactions";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { formatCents } from "../lib/money";

/** CAT-13: click-to-edit merchant name. Enter/blur saves, Escape cancels;
 * an empty save clears the override back to
 * `merchantName ?? merchantNameNormalized` (the API's own
 * empty-string-clears convention). */
function MerchantCell({ item }: { item: TransactionListItem }) {
  const setOverride = useSetMerchantNameOverrideMutation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.merchantName);

  function startEditing(): void {
    setDraft(item.merchantName);
    setEditing(true);
  }

  function save(): void {
    const trimmed = draft.trim();
    if (trimmed !== item.merchantName) {
      setOverride.mutate({ transactionId: item.id, merchantNameOverride: trimmed });
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        className="h-7 w-40 text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={save}
        aria-label={`Merchant name for ${item.merchantName}`}
      />
    );
  }

  return (
    <button
      type="button"
      className="group inline-flex items-center gap-1.5 text-left text-ink"
      onClick={startEditing}
      title="Click to rename this merchant"
    >
      {item.merchantName}
      {item.pending && (
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          Pending
        </span>
      )}
      <span className="text-[11px] font-normal text-ink-muted underline decoration-dotted opacity-0 group-hover:opacity-100">
        Rename
      </span>
    </button>
  );
}

// WEB-12: Plaid's raw sign (amount > 0 = expense, amount < 0 = income --
// WEB-9's convention, untouched) is correct for the *color* below, but
// pairing that with formatCents(item.amount)'s raw signed digits was
// backwards from how every consumer finance app actually displays an
// amount: an expense should carry the minus sign, income should not.
// This only flips what's rendered as text -- item.amount itself, and
// every other reader of Transaction.amount (matching.ts, ANLY-5's
// spending filter, the color class two lines below), keeps using
// Plaid's real signed value untouched.
function formatAmountDisplay(amount: number): string {
  if (amount === 0) return formatCents(0);
  return amount > 0 ? `-${formatCents(Math.abs(amount))}` : formatCents(Math.abs(amount));
}

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
                <MerchantCell item={item} />
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
    </div>
  );
}
