// categories.ts — the category taxonomy Tier 3 (LLM) picks from
// (ARCHITECTURE.md §2.3, ADR-0026). Tier 1/2 don't consume this: their
// categories come from whatever a person or a prior Tier 3 write-back
// (CAT-6) already put into MerchantRules/Transaction.category.value,
// which is free text -- ARCHITECTURE.md never defines a fixed taxonomy at
// the schema level, and Transaction.category.value is a plain string.
//
// Tier 3 is different. Every categorize-llm batch is a fresh model call
// with no memory of prior calls, so without a fixed list handed to it
// every time, the same merchant could land in "Dining", "Restaurants",
// and "Food & Drink" across three different runs -- fragmenting the
// category space Tier 1/2 depend on staying small and stable (and
// undermining CAT-6's write-back loop, which only shrinks Tier 3 usage
// over time if repeated LLM calls actually agree with each other).
//
// A plain, editable array -- not a DB enum, not baked into
// CategorizationProvider -- so changing the taxonomy later is a one-line
// edit here, not a migration. CategorizationProvider.categorizeBatch()
// takes `categories: readonly string[]` for exactly this reason: it has
// no opinion on what the list contains.
export const DEFAULT_CATEGORIES = [
  "Groceries",
  "Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Bills & Utilities",
  "Rent & Housing",
  "Health & Fitness",
  "Travel",
  "Subscriptions",
  "Insurance",
  "Education",
  "Personal Care",
  "Gifts & Donations",
  "Fees & Charges",
  "Income",
  "Transfer",
  // A real choice offered to the model, not just the tier-4
  // sync-placeholder value (sync/normalize.ts UNCATEGORIZED) -- lets it
  // say "none of these fit" instead of forcing a guess into the nearest
  // wrong bucket. Still lands as tier: 3 when the model picks it
  // (categorize/tier3.ts), distinct from "never attempted".
  "Uncategorized",
] as const;

export type DefaultCategory = (typeof DEFAULT_CATEGORIES)[number];
