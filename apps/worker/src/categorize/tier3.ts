// tier3.ts — Tier 3 LLM confidence/outcome resolver (ARCHITECTURE.md
// §2.3, BACKLOG.md CAT-5). Pure function, no I/O:
// apps/worker/src/queues/categorizeLlm.ts calls
// CategorizationProvider.categorizeBatch() (the I/O), then this function
// decides, per result, whether that answer is trustworthy enough to
// confirm outright or needs a human's eyes in the Tier 4 review queue.
import type { CategorizationResult } from "@financial-os/providers";
import type { TransactionCategory } from "@financial-os/db";

/**
 * Turns one CategorizationProvider result into the TransactionCategory
 * written to Transaction.category. Always tagged `tier: 3` -- never the
 * `tier: 4` UNCATEGORIZED sentinel (sync/normalize.ts) -- so
 * `isUncategorized()` keeps its precise "never attempted" meaning even
 * for a transaction Tier 3 tried and failed on. That also means a
 * low-confidence or totally-unparseable Tier 3 attempt naturally stays
 * eligible for the *next* categorize-llm run to retry: `findNeedsReview()`
 * filters on `category.status`, not `category.tier`, so nothing here
 * needs its own "already attempted" bookkeeping (ADR-0026).
 *
 * `result.uncertain` and a low `result.confidence` are checked
 * independently, and either alone is enough to route to review: a model
 * that says "I'm not sure" about a high raw score is still saying it's
 * not sure, and a confidence score below the threshold means what it says
 * regardless of the flag. `confidenceThreshold` is inclusive -- exactly
 * matching it counts as confirmed -- the same convention
 * categorize/tier2.ts's FUZZY_MATCH_THRESHOLD uses.
 */
export function resolveTier3Outcome(
  result: CategorizationResult,
  confidenceThreshold: number,
): TransactionCategory {
  const status =
    result.uncertain || result.confidence < confidenceThreshold ? "needs_review" : "confirmed";
  return {
    tier: 3,
    value: result.category,
    confidence: result.confidence,
    status,
  };
}
