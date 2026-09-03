// categories.ts — Phase 1's default category taxonomy (ARCHITECTURE.md
// §2.3, ADR-0026, ADR-0028). Tier 1/2 don't consume this: their categories
// come from whatever a person or a prior Tier 3 write-back (CAT-6) already
// put into MerchantRules/Transaction.category.value, which is free text --
// ARCHITECTURE.md never defines a fixed taxonomy at the schema level.
//
// DEFAULT_CATEGORY_SEEDS is no longer fed to categorizeBatch() directly
// (CAT-9): it's the one-time seed list resolveUserCategoryNames()
// (categorize/userCategories.ts) hands to CategoryRepository.seedDefaults()
// the first time a user has no Category rows yet. After that, a user's own
// Category collection is Tier 3's real source -- fully editable (rename,
// recolor via CAT-10, archive, add a custom one) independent of this list
// and of every other user. Kept as a plain array here, not a DB enum and
// not baked into CategorizationProvider, for the same reason as before:
// CategorizationProvider.categorizeBatch() takes `categories: readonly
// string[]` and has no opinion on where they came from.
//
// Every category needs a Tier 3 target that means "the model doesn't have
// to guess" (a real choice offered to it, not just the tier-4
// sync-placeholder value in sync/normalize.ts's UNCATEGORIZED) and a color
// (CAT-10) -- Uncategorized gets the chart-chrome muted ink tone rather
// than a categorical hue, since giving it a vivid color would visually
// suggest it's a normal spending category instead of "none of these fit."
// The other 17 cycle the dataviz skill's validated 8-hue categorical
// palette (references/palette.md) in fixed order -- past slot 8 hues
// repeat, which the palette's own docs call out as outside its validated
// (<=8) range; that's an accepted tradeoff for a seed default a user can
// freely recolor (CAT-10), not a simultaneous chart legend needing
// pairwise CVD separation across all 18 at once.
export interface DefaultCategorySeed {
  readonly name: string;
  readonly color: string;
  /** CAT-11: a lucide-react icon key from apps/web's curated, fixed set
   * (apps/web/src/design/categoryIcons.tsx -- duplicated here rather than
   * imported, the same "each app defines the same small constant list
   * independently" precedent CATEGORICAL_PALETTE above already
   * establishes between this file and apps/web/src/design/tokens.ts,
   * since apps/worker has no dependency on apps/web either way). */
  readonly icon: string;
  /** CAT-16: "income" | "expense", for the /categories management page's
   * grouping of the seeded defaults (packages/db's CategoryRepository.
   * seedDefaults() carries it through when present -- see that field's
   * own doc comment on CategorySeed). Optional, and only set below on
   * "Income" -- every other entry, "Transfer" and "Uncategorized"
   * included, has no clean income/expense answer (a transfer is neither,
   * and "uncategorized" is a non-answer), so they're left to fall
   * through to the schema's own "expense" default rather than this file
   * inventing a third bucket the schema doesn't have. Worth a second
   * look, not silently decided: Transfer/Uncategorized landing in
   * "Expense" by omission is a judgment call, not a considered "these
   * are expenses." */
  readonly kind?: "income" | "expense";
}

export const DEFAULT_CATEGORY_SEEDS: readonly DefaultCategorySeed[] = [
  { name: "Groceries", color: "#2a78d6", icon: "shopping-cart" },
  { name: "Dining", color: "#eb6834", icon: "utensils" },
  { name: "Transportation", color: "#1baf7a", icon: "car" },
  { name: "Shopping", color: "#eda100", icon: "shopping-bag" },
  { name: "Entertainment", color: "#e87ba4", icon: "clapperboard" },
  { name: "Bills & Utilities", color: "#008300", icon: "receipt" },
  { name: "Rent & Housing", color: "#4a3aa7", icon: "home" },
  { name: "Health & Fitness", color: "#e34948", icon: "heart-pulse" },
  { name: "Travel", color: "#2a78d6", icon: "plane" },
  { name: "Subscriptions", color: "#eb6834", icon: "repeat" },
  { name: "Insurance", color: "#1baf7a", icon: "shield" },
  { name: "Education", color: "#eda100", icon: "graduation-cap" },
  { name: "Personal Care", color: "#e87ba4", icon: "sparkles" },
  { name: "Gifts & Donations", color: "#008300", icon: "gift" },
  { name: "Fees & Charges", color: "#4a3aa7", icon: "banknote" },
  { name: "Income", color: "#e34948", icon: "trending-up", kind: "income" },
  { name: "Transfer", color: "#2a78d6", icon: "arrow-left-right" },
  // See the file comment above -- deliberately not a categorical hue.
  { name: "Uncategorized", color: "#898781", icon: "circle-help" },
  // CAT-18: four more kind: "income" categories, added alongside the
  // existing "Income" rather than splitting or renaming it (Category.name
  // is free text on Transaction.category.value -- renaming would silently
  // orphan every transaction already tagged "Income" from the active
  // category list). Appended after Uncategorized, not inserted earlier
  // next to "Income" itself, specifically so the palette cycle above
  // keeps every existing entry's color exactly as it was -- inserting
  // these first would have pushed Transfer/Uncategorized to new array
  // positions and, for Transfer, a new cycle color, which is a visible
  // change nothing about this ticket asked for.
  //
  // CAT-17's gap: a negative-amount transaction (money in) that isn't a
  // paycheck -- a refund, interest, a gift, anything else -- had nowhere
  // to go but this same generic "Income" bucket. These give the
  // categorization model, and CAT-12's future manual recategorize
  // control, somewhere more specific to put it.
  { name: "Reimbursement", color: "#1baf7a", icon: "rotate-ccw", kind: "income" },
  { name: "Interest & Dividends", color: "#eda100", icon: "percent", kind: "income" },
  // "gift" is already "Gifts & Donations"'s (expense-side) icon --
  // reusing it here would make the two indistinguishable at a glance in
  // exactly the place (an icon picker) where that distinction matters
  // most, so this gets its own icon (CAT-19).
  { name: "Gifts Received", color: "#e87ba4", icon: "party-popper", kind: "income" },
  { name: "Other Income", color: "#008300", icon: "circle-plus", kind: "income" },
] as const;

/** Name-only projection of the seed list -- test-categorization.ts (CAT-4/5's
 * standalone smoke test) still imports this directly, since it deliberately
 * has no DB connection to seed/read a real Category collection from. */
export const DEFAULT_CATEGORIES: readonly string[] = DEFAULT_CATEGORY_SEEDS.map((c) => c.name);

export type DefaultCategory = (typeof DEFAULT_CATEGORY_SEEDS)[number]["name"];
