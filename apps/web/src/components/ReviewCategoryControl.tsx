// components/ReviewCategoryControl.tsx — CAT-7's manual-correction
// control, plugged into TransactionsTable's `renderRowAction` slot on the
// review queue only (WEB-8's plain ledger view never passes
// renderRowAction, so this never renders there).
//
// CAT-15: the plain native <select> this originally shipped with (CAT-7)
// is now CategorySelect.tsx, a styled Radix listbox -- a native <option>
// can only ever render plain text, and showing this user's category icon
// per row is a real requirement now, not a nice-to-have. Every behavior
// this control had before is unchanged:
// the current value still shows even when it isn't in the active list
// (the "not currently listed" fallback option, now rendered with no
// icon/swatch of its own since it isn't backed by a real Category row),
// the aria-label, disabled-while-pending, and commit-on-change all carry
// over exactly.
import { useState } from "react";
import { useCategoriesQuery } from "../api/categories";
import { useCorrectCategoryMutation } from "../api/transactions";
import type { TransactionListItem } from "../api/transactions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CategorySelect } from "./CategorySelect";
import type { CategorySelectOption } from "./CategorySelect";

export interface ReviewCategoryControlProps {
  transaction: TransactionListItem;
}

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
  // to pick from -- CategorySelect (CAT-15), a styled Radix listbox
  // showing each option's icon, not a plain native <select> (which can't
  // render one at all).
  if (hasCategories) {
    const currentIsListed = categories.data?.some((c) => c.name === transaction.category.value);
    // The transaction's current value might not be in the active list
    // (an archived category, or a raw Tier 1-3 guess that was never
    // added as a real Category row) -- offered anyway, first in the
    // list, so the control shows what's actually on the transaction
    // instead of silently jumping to the first real option. It isn't
    // backed by a real Category row, so it gets no icon/swatch of its
    // own -- same as before this ticket, just via CategorySelect's
    // `icon`/`color` being left undefined rather than a plain <option>.
    const options: CategorySelectOption[] = [
      ...(currentIsListed
        ? []
        : [{ value: transaction.category.value, label: transaction.category.value }]),
      ...(categories.data ?? []).map((c) => ({
        value: c.name,
        label: c.name,
        icon: c.icon,
        color: c.color,
      })),
    ];
    return (
      <CategorySelect
        value={transaction.category.value}
        onChange={commit}
        options={options}
        disabled={correct.isPending}
        ariaLabel={`Category for ${transaction.merchantName}`}
      />
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
