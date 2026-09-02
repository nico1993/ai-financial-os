// components/AddCategoryForm.tsx — CAT-14: "a minimal but real 'add
// category' affordance ... near wherever categories are already
// listed/selected in the UI."
//
// CAT-16 relocated this from ReviewPage.tsx onto the new
// pages/CategoriesPage.tsx -- CAT-9's own delivered note already flagged
// ReviewPage as only a provisional home ("CAT-12's fuller edit popup is
// expected to relocate this once it lands"), and a dedicated category
// management page is a more natural home than CAT-12 ever was (CAT-12
// itself isn't built yet). ReviewPage.tsx goes back to just the review
// queue.
//
// CAT-16 also adds the kind toggle below (income/expense, default
// expense) -- threaded through to useCreateCategoryMutation() so a
// custom category can pick a kind at creation, mainly so a future
// income-vs-expense distinction elsewhere in the app has something to
// read (CategoriesPage's own grouping always shows a custom category
// under "Custom" regardless of its kind -- see that page's comment).
import { useState } from "react";
import { useCreateCategoryMutation } from "../api/categories";
import type { CategoryKind } from "../api/categories";
import { getApiErrorMessage } from "../api/client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { IconPicker } from "./IconPicker";
import { cn } from "../lib/utils";

const DEFAULT_ICON = "tag";
const DEFAULT_KIND: CategoryKind = "expense";

const KIND_OPTIONS: { value: CategoryKind; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
];

export function AddCategoryForm() {
  const createCategory = useCreateCategoryMutation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [kind, setKind] = useState<CategoryKind>(DEFAULT_KIND);

  function reset(): void {
    setName("");
    setIcon(DEFAULT_ICON);
    setKind(DEFAULT_KIND);
    setOpen(false);
  }

  function handleSubmit(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    createCategory.mutate({ name: trimmed, icon, kind }, { onSuccess: reset });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        + Add category
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-secondary p-3">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          className="h-8 w-48 text-sm"
          placeholder="Category name"
          value={name}
          disabled={createCategory.isPending}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") reset();
          }}
        />
        {/* CAT-16: income/expense at creation -- a plain two-button
            toggle rather than a third picker component, since there are
            only ever these two values. */}
        <div
          className="flex overflow-hidden rounded-md border border-border"
          role="radiogroup"
          aria-label="Category kind"
        >
          {KIND_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={kind === option.value}
              disabled={createCategory.isPending}
              onClick={() => setKind(option.value)}
              className={cn(
                "h-8 px-2.5 text-xs font-medium transition-colors",
                kind === option.value
                  ? "bg-accent-wash text-accent"
                  : "bg-surface text-ink-secondary hover:text-ink",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          disabled={createCategory.isPending || !name.trim()}
          onClick={handleSubmit}
        >
          {createCategory.isPending ? "Adding…" : "Add"}
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          Cancel
        </Button>
      </div>
      <IconPicker value={icon} onChange={setIcon} />
      {createCategory.isError && (
        <p role="alert" className="text-xs text-critical-text">
          {getApiErrorMessage(createCategory.error, "Could not create that category.")}
        </p>
      )}
    </div>
  );
}
