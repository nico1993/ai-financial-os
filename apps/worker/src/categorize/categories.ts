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
}

export const DEFAULT_CATEGORY_SEEDS: readonly DefaultCategorySeed[] = [
  { name: "Groceries", color: "#2a78d6" },
  { name: "Dining", color: "#eb6834" },
  { name: "Transportation", color: "#1baf7a" },
  { name: "Shopping", color: "#eda100" },
  { name: "Entertainment", color: "#e87ba4" },
  { name: "Bills & Utilities", color: "#008300" },
  { name: "Rent & Housing", color: "#4a3aa7" },
  { name: "Health & Fitness", color: "#e34948" },
  { name: "Travel", color: "#2a78d6" },
  { name: "Subscriptions", color: "#eb6834" },
  { name: "Insurance", color: "#1baf7a" },
  { name: "Education", color: "#eda100" },
  { name: "Personal Care", color: "#e87ba4" },
  { name: "Gifts & Donations", color: "#008300" },
  { name: "Fees & Charges", color: "#4a3aa7" },
  { name: "Income", color: "#e34948" },
  { name: "Transfer", color: "#2a78d6" },
  // See the file comment above -- deliberately not a categorical hue.
  { name: "Uncategorized", color: "#898781" },
] as const;

/** Name-only projection of the seed list -- test-categorization.ts (CAT-4/5's
 * standalone smoke test) still imports this directly, since it deliberately
 * has no DB connection to seed/read a real Category collection from. */
export const DEFAULT_CATEGORIES: readonly string[] = DEFAULT_CATEGORY_SEEDS.map((c) => c.name);

export type DefaultCategory = (typeof DEFAULT_CATEGORY_SEEDS)[number]["name"];
