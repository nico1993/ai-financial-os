// components/TransactionsLedger.tsx — WEB-13's redesigned row rendering
// for `/transactions` specifically. Deliberately a NEW, separate
// component rather than a rewrite of TransactionsTable.tsx: that
// component is also ReviewPage.tsx's row rendering (CAT-7) and
// TransferReviewControl.tsx's action-column host (XFER-7), and this
// ticket's own text scopes the visual redesign to `/transactions` alone
// ("this ticket is presentation/layout only, plus the one new
// account-filter dimension") -- touching the shared table would have
// redesigned the review queue too, which nobody asked for. The one
// interaction this keeps identical to TransactionsTable.tsx: click any
// row to open CAT-12's TransactionEditDialog (its own local
// `editingItem` state + one mounted instance, same pattern).
//
// Row content, per the ticket's own screenshot-sourced spec: a larger
// circular category-icon avatar tinted by the category's own color (CAT-
// 20's `CategoryIcon` `style` prop, built general specifically for this
// reuse -- see that story's delivered note), with the category name as
// the row's primary text and the raw bank description
// (Transaction.description, distinct from merchantName -- CAT-13)
// directly under it as secondary muted text, exactly as specified.
// merchantName/account weren't named in that same sentence, but dropping
// them outright would silently regress information every other view of
// a transaction still shows -- kept, just demoted to a secondary column
// on the row's other side rather than removed. Flagged as a judgment
// call in BACKLOG.md's own delivered note, not a literal reading of the
// ticket text.
import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import type { TransactionListItem } from "../api/transactions";
import type { CategoryListItem } from "../api/categories";
import { CategoryIcon } from "../design/categoryIcons";
import { UI_COLOR } from "../design/tokens";
import { accountDisplayName } from "../lib/accountDisplayName";
import { formatAmountDisplay, formatSignedCents } from "../lib/money";
import { groupTransactionsByDay } from "../lib/groupTransactionsByDay";
import { TransactionEditDialog } from "./TransactionEditDialog";

const DAY_HEADER_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDayHeaderLabel(iso: string): string {
  return DAY_HEADER_FORMAT.format(new Date(iso));
}

interface TransactionRowProps {
  item: TransactionListItem;
  /** undefined on a join miss -- `Transaction.category.value` is free
   * text, not a foreign key into Category (see that model's own doc
   * comment), so a renamed/deleted category simply falls back to no
   * tint/icon rather than this throwing or hiding the row. */
  categoryMeta?: CategoryListItem;
  onOpen: () => void;
}

function TransactionRow({ item, categoryMeta, onOpen }: TransactionRowProps) {
  const color = categoryMeta?.color;
  return (
    <div
      // CAT-12's "click any row" convention, unchanged from
      // TransactionsTable.tsx -- tabIndex/role/onKeyDown for keyboard
      // reachability, not just a mouse affordance.
      tabIndex={0}
      role="button"
      aria-label={`Edit transaction: ${item.merchantName}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className="group flex cursor-pointer items-center gap-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 hover:bg-surface-secondary"
    >
      <div
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: color ? `${color}26` : UI_COLOR.border }}
        aria-hidden="true"
      >
        <CategoryIcon
          icon={categoryMeta?.icon}
          className="h-5 w-5 text-ink-secondary"
          style={color ? { color } : undefined}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink">{item.category.value}</span>
          {item.pending && (
            <span className="flex-shrink-0 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              Pending
            </span>
          )}
          <Pencil
            className="h-3 w-3 flex-shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </div>
        <div className="truncate text-xs text-ink-muted">{item.description}</div>
      </div>

      <div className="hidden min-w-0 flex-1 text-right sm:block">
        <div className="truncate text-sm text-ink-secondary">{item.merchantName}</div>
        <div className="truncate text-xs text-ink-muted">
          {/* ACCT-3's display precedence, same as TransactionsTable.tsx. */}
          {accountDisplayName(item.account)}
          {item.account.subtype && ` · ${item.account.subtype}`}
        </div>
      </div>

      {/* WEB-9: Plaid's sign convention, not the intuitive one -- see
          TransactionsTable.tsx's identical comment. */}
      <div
        className={`flex-shrink-0 whitespace-nowrap text-right font-mono text-sm tabular-nums ${
          item.amount > 0 ? "text-critical-text" : item.amount < 0 ? "text-good-text" : "text-ink"
        }`}
      >
        {formatAmountDisplay(item.amount)}
      </div>
    </div>
  );
}

export interface TransactionsLedgerProps {
  items: TransactionListItem[];
  /** This user's full category list (useCategoriesQuery()) -- joined
   * locally by name to each row's `category.value` for its icon/color,
   * rather than a backend change. Keeps buildTransactionList() (the
   * shared API shape ReviewPage.tsx/XFER-7 also consume) from having to
   * carry icon/color on every response just for this one page's avatar
   * treatment. */
  categories: CategoryListItem[];
}

export function TransactionsLedger({ items, categories }: TransactionsLedgerProps) {
  const [editingItem, setEditingItem] = useState<TransactionListItem | null>(null);
  const categoryByName = useMemo(
    () => new Map(categories.map((c) => [c.name, c] as const)),
    [categories],
  );
  const groups = useMemo(() => groupTransactionsByDay(items), [items]);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.date}>
          <div className="mb-1 flex items-baseline justify-between border-b border-border pb-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
              {formatDayHeaderLabel(group.date)}
            </span>
            <span
              className={`font-mono text-xs tabular-nums ${
                group.netTotal > 0
                  ? "text-good-text"
                  : group.netTotal < 0
                    ? "text-critical-text"
                    : "text-ink-muted"
              }`}
            >
              {formatSignedCents(group.netTotal)}
            </span>
          </div>
          <div className="divide-y divide-border">
            {group.items.map((item) => (
              <TransactionRow
                key={item.id}
                item={item}
                categoryMeta={categoryByName.get(item.category.value)}
                onOpen={() => setEditingItem(item)}
              />
            ))}
          </div>
        </div>
      ))}
      <TransactionEditDialog
        transaction={editingItem}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null);
        }}
      />
    </div>
  );
}
