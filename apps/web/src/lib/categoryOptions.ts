// lib/categoryOptions.ts — CAT-12: extracted out of
// ReviewCategoryControl.tsx (CAT-7/CAT-15's own inline logic) so
// TransactionEditDialog's category field can build the exact same
// CategorySelectOption list -- including the "current value isn't in
// the active list" fallback -- without re-deriving the rule a second
// time (the same reasoning ACCT-3 extracted accountDisplayName for).
import type { CategoryListItem } from "../api/categories";
import type { CategorySelectOption } from "../components/CategorySelect";

/**
 * `currentValue` might not be in `categories` at all (an archived
 * category, or a raw Tier 1-3 guess that was never added as a real
 * Category row) -- offered anyway, first in the list, so the control
 * shows what's actually on the transaction instead of silently jumping
 * to the first real option. It isn't backed by a real Category row, so
 * it gets no icon/color of its own.
 */
export function buildCategorySelectOptions(
  categories: readonly CategoryListItem[],
  currentValue: string,
): CategorySelectOption[] {
  const currentIsListed = categories.some((c) => c.name === currentValue);
  return [
    ...(currentIsListed ? [] : [{ value: currentValue, label: currentValue }]),
    ...categories.map((c) => ({
      value: c.name,
      label: c.name,
      icon: c.icon,
      color: c.color,
    })),
  ];
}
