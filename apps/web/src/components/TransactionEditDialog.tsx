// components/TransactionEditDialog.tsx — CAT-12: click any transaction
// row to open this, rename the description (CAT-13's override field)
// and/or recategorize (CAT-7) in one popup, saved together in a single
// PATCH (api/transactions.ts's useUpdateTransactionMutation). Folds
// TransactionsTable.tsx's old standalone inline merchant-rename control
// (CAT-13's own stand-in) into this one "click the row" affordance, per
// that story's own note that CAT-12 should do exactly that.
//
// This ticket's text names a third field, "pick the category's icon" --
// that doesn't need its own control here. A category's icon is
// CategorySelect's own per-option rendering (CAT-15/CAT-20), so
// recategorizing already shows and changes it; there's no per-transaction
// icon field in this schema, only Category.icon (CAT-11). Changing an
// existing category's own icon already has its proper home
// (CategoriesPage.tsx / PATCH /api/categories/:id, CAT-16) -- doing it
// from here would silently reskin every other transaction in that
// category too, not just this one, which isn't what "edit this
// transaction" should do.
//
// Still open, not decided here: whether this popup's category field
// should support creating a new category inline (CAT-14's own form).
// Not built that way this pass -- the user's own 2026-09-02
// reconfirmation of this popup's scope described exactly "edit the
// merchant/description and category," and CategoriesPage.tsx already
// exists as the dedicated place to create one; easy to add
// AddCategoryForm.tsx here later if that turns out to be wanted.
//
// Controlled from the outside (the transaction being edited, or null)
// rather than owning its own open state or trigger -- TransactionsTable
// mounts exactly one instance and points it at whichever row was
// clicked, rather than one Dialog per row.
import { useEffect, useState } from "react";
import { useCategoriesQuery } from "../api/categories";
import { useUpdateTransactionMutation } from "../api/transactions";
import type { TransactionListItem } from "../api/transactions";
import { getApiErrorMessage } from "../api/client";
import { buildCategorySelectOptions } from "../lib/categoryOptions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { DialogRoot, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { CategorySelect } from "./CategorySelect";

export interface TransactionEditDialogProps {
  /** The row being edited, or `null` when the dialog should be closed.
   * TransactionsTable owns this as its own `editingItem` state. */
  transaction: TransactionListItem | null;
  onOpenChange: (open: boolean) => void;
}

export function TransactionEditDialog({ transaction, onOpenChange }: TransactionEditDialogProps) {
  const categories = useCategoriesQuery();
  const update = useUpdateTransactionMutation();
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");

  // Resets the draft whenever a *different* transaction opens (not on
  // every keystroke -- this only re-runs when the `transaction` prop
  // itself changes identity).
  useEffect(() => {
    if (transaction) {
      setDescription(transaction.merchantName);
      setCategory(transaction.category.value);
    }
  }, [transaction]);

  function save(): void {
    if (!transaction) return;
    const trimmedDescription = description.trim();
    const descriptionChanged = trimmedDescription !== transaction.merchantName;
    const categoryChanged = category !== transaction.category.value;
    if (!descriptionChanged && !categoryChanged) {
      onOpenChange(false);
      return;
    }
    update.mutate(
      {
        transactionId: transaction.id,
        ...(categoryChanged ? { category } : {}),
        // Empty clears the override back to
        // merchantName ?? merchantNameNormalized -- CAT-13's own
        // convention, not a validation error, so this is deliberately
        // not blocked by a "non-empty" check anywhere in this file.
        ...(descriptionChanged ? { merchantNameOverride: trimmedDescription } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <DialogRoot open={transaction !== null} onOpenChange={onOpenChange}>
      {transaction && (
        <DialogContent>
          <DialogTitle>Edit transaction</DialogTitle>
          <DialogDescription className="mb-3">
            {new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(transaction.date))}
          </DialogDescription>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-secondary">Description</span>
              <Input
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
                aria-label="Transaction description"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-secondary">Category</span>
              <CategorySelect
                value={category}
                onChange={setCategory}
                options={buildCategorySelectOptions(categories.data ?? [], category)}
                ariaLabel="Transaction category"
                disabled={categories.isLoading}
                className="w-full"
              />
            </label>
            {update.isError && (
              <p role="alert" className="text-xs text-critical-text">
                {getApiErrorMessage(update.error, "Could not save these changes.")}
              </p>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={update.isPending} onClick={save}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      )}
    </DialogRoot>
  );
}
