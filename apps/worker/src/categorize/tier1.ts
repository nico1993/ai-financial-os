// tier1.ts — Tier 1 exact-match categorization resolver (ARCHITECTURE.md
// §2.3, BACKLOG.md CAT-1). Pure function, no I/O: CAT-3 wires this inline
// into the sync job by loading a user's exact-match MerchantRule rows and
// building the index this function reads.
import type { TransactionCategory } from "@financial-os/db";

export interface Tier1RuleRow {
  /** MerchantRule.pattern for an 'exact' row -- a normalized merchant
   * string (see sync/normalize.ts normalizeMerchantName()). */
  pattern: string;
  category: string;
}

/** Builds the lookup index resolveTier1() reads, from whatever exact-match
 * MerchantRule rows the caller loaded. A plain Map keeps this decoupled
 * from Mongoose documents, so callers can build it from a DB query, a test
 * fixture, or a cache -- no adapter code either way.
 *
 * The unique (userId, pattern) index on MerchantRule (partial: matchType
 * 'exact') means two rows can't collide for one user in the database, but
 * this function has no visibility into that constraint. Last-one-wins,
 * deterministically, rather than throwing: a rules table is advisory data,
 * not something that should be able to crash the sync job. */
export function buildTier1Index(rules: readonly Tier1RuleRow[]): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const rule of rules) index.set(rule.pattern, rule.category);
  return index;
}

/** The Tier 1 lookup itself (§2.3): does `normalizedMerchant` have a
 * confirmed category on file? `normalizedMerchant` must already be
 * normalized -- this function trusts the caller (the sync job, via
 * Transaction.merchantNameNormalized) rather than re-normalizing, so there
 * is exactly one normalization implementation to keep in sync with what is
 * stored (normalizeMerchantName in sync/normalize.ts).
 *
 * Returns undefined on a miss so CAT-3 can fall through to Tier 2, rather
 * than returning some "uncategorized" category -- that would collapse "no
 * rule matched" and "a rule matched and says X" into the same shape. */
export function resolveTier1(
  normalizedMerchant: string,
  index: ReadonlyMap<string, string>,
): TransactionCategory | undefined {
  const category = index.get(normalizedMerchant);
  if (category === undefined) return undefined;
  return { tier: 1, value: category, status: "confirmed" };
}
