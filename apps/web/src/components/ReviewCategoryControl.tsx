// components/ReviewCategoryControl.tsx — CAT-7's manual-correction
// control, plugged into TransactionsTable's `renderRowAction` slot on the
// review queue only (WEB-8's plain ledger view never passes
// renderRowAction, so this never renders there).
import { useState } from "react";
import { useCategoriesQuery } from "../api/categories";
import { useCorrectCategoryMutation } from "../api/transactions";
import type { TransactionListItem } from "../api/transactions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface ReviewCategoryControlProps {
  transaction: TransactionListItem;
}

const SELECT_CLASSNAME =
  "h-8 rounded-md border border-border bg-surface-secondary px-2 text-xs text-ink " +
  "focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function ReviewCategoryControl({ transaction }: ReviewCategoryControlProps) {
  const categories = useCategoriesQuery();
  const correct = useCorrectCategoryMutation();
  const [draft, setDraft] = useState("");

  function commit(value: string): void {
    const trimmed = value.trim();
    if (!trimmed || trimmed === transaction.category.value) return;
    correct.mutate({ transactionId: transaction.id, category: trimmed });
  }

  if (categories.isLoading) {
    return <span className="text-xs text-ink-muted">Loading…</span>;
  }

  const hasCategories = Boolean(categories.data && categories.data.length > 0);

  // The common case: this user has a real Category list (CAT-9/ADR-0028)
  // to pick from -- a plain native <select>, not a hand-rolled dropdown
  // (no Radix Select in this app's component set yet, ADR-0033's
  // precedent of not adding a dependency for something this simple).
  if (hasCategories) {
    const currentIsListed = categories.data?.some((c) => c.name === transaction.category.value);
    return (
      <select
        className={SELECT_CLASSNAME}
        value={transaction.category.value}
        disabled={correct.isPending}
        onChange={(e) => commit(e.target.value)}
        aria-label={`Category for ${transaction.merchantName}`}
      >
        {/* The transaction's current value might not be in the active
            list (an archived category, or a raw Tier 1-3 guess that was
            never added as a real Category row) -- offered anyway so the
            select shows what's actually on the transaction instead of
            silently jumping to the first real option. */}
        {!currentIsListed && (
          <option value={transaction.category.value}>{transaction.category.value}</option>
        )}
        {categories.data?.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
    );
  }

  // No Category rows exist yet for this user -- Tier 3 hasn't run long
  // enough to seed them (CategoryRepository.seedDefaults() only fires
  // from inside a categorize-llm run that actually finds work,
  // apps/worker/src/queues/categorizeLlm.ts), which can genuinely happen
  // in the window between a sync landing a needs_review transaction and
  // that job completing. Blocking correction on that would be a worse
  // experience than a plain text fallback.
  return (
    <div className="flex items-center gap-1.5">
      <Input
        className="h-8 w-36 text-xs"
        placeholder="Category name"
        value={draft}
        disabled={correct.isPending}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={`Category for ${transaction.merchantName}`}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={correct.isPending || !draft.trim()}
        onClick={() => {
          commit(draft);
          setDraft("");
        }}
      >
        Save
      </Button>
    </div>
  );
}
