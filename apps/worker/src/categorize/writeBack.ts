// writeBack.ts — CAT-6's write-back decision (ARCHITECTURE.md §2.3, ADR-0027).
// Pure function, no I/O: apps/worker/src/queues/categorizeLlm.ts calls this
// after resolveTier3Outcome() decides confirmed/needs_review, then does the
// actual MerchantRuleRepository.upsertExact() write (the I/O) only when this
// returns non-null.
import type { TransactionCategory } from "@financial-os/db";
import type { MerchantRuleWriteBack } from "@financial-os/db";

/**
 * Should this categorization be cached into MerchantRules? Only a
 * `confirmed` category writes back -- a `needs_review` result (low
 * confidence, or the model/human flagged it uncertain) hasn't earned a
 * permanent Tier 1 rule. Writing that back would let one shaky guess
 * mis-categorize every future transaction from that merchant instead of
 * just the one it was actually about; §2.3's write-back loop is meant to
 * shrink Tier 3 usage over time by caching decisions worth trusting, not
 * to propagate uncertainty.
 *
 * Total and side-effect-free: returns null rather than throwing for
 * anything that shouldn't write back, so the caller never needs a
 * try/catch just to skip a needs_review result.
 *
 * `source` is the caller's to decide, not this function's -- today
 * categorizeLlm.ts always passes "llm"; CAT-7's manual-correction path is
 * expected to call this (or skip straight to MerchantRuleRepository) with
 * "manual" once it exists.
 */
export function buildMerchantRuleWriteBack(
  userId: string,
  normalizedMerchant: string,
  category: TransactionCategory,
  source: MerchantRuleWriteBack["source"],
): MerchantRuleWriteBack | null {
  if (category.status !== "confirmed") return null;
  return { userId, pattern: normalizedMerchant, category: category.value, source };
}
