// CategorizationProvider — the interface CAT-4's queue job calls, never an
// LLM SDK/HTTP client directly (ARCHITECTURE.md §2.3, ADR-0026). Ollama is
// the only implementation for Phase 1 (ollama/OllamaCategorizationProvider.ts),
// but nothing outside that adapter should know which LLM backend is
// running or what its request/response shape looks like -- the same
// boundary ADR-0004 draws around FinancialProvider/Plaid.

/** One transaction handed to the model. Deliberately thin: enough signal
 * to categorize, nothing the model doesn't need (no userId, no raw
 * provider payload). */
export interface CategorizationCandidate {
  /** Transaction._id as a string, round-tripped so the caller can map
   * results back onto documents without this interface knowing anything
   * about Mongo. */
  transactionId: string;
  /** The Tier 1 lookup key -- already stripped of processor noise, so
   * it's usually the clearer signal than the raw description alone. */
  normalizedMerchant: string;
  description: string;
  /** Integer cents, sign included -- a credit/refund is itself a
   * categorization signal the model can use. */
  amount: number;
  isoCurrencyCode: string;
}

export interface CategorizationResult {
  transactionId: string;
  category: string;
  /** 0..1. CAT-5's confidence threshold decides confirmed vs needs_review
   * from this -- this interface only reports what the model said. */
  confidence: number;
  /** True when the model itself flagged low confidence/ambiguity. Kept
   * distinct from a low `confidence` score: the model saying "I don't
   * know" is a different signal than a middling numeric score, and a
   * response this adapter couldn't parse at all is reported the same way
   * (confidence: 0, uncertain: true) rather than as a missing entry. */
  uncertain: boolean;
}

export interface CategorizationProvider {
  /**
   * Categorizes a batch in one call (ARCHITECTURE.md §2.3: ~20-50
   * tx/batch, to minimize per-call overhead). `categories` is the app's
   * current taxonomy (apps/worker/src/categorize/categories.ts) -- this
   * interface has no opinion on what categories exist, only on how to ask
   * a model to pick among them.
   *
   * Total by contract, the same pattern ADR-0024 uses for
   * `parseWebhook()`: the returned array always has exactly one result
   * per input candidate, in any order. A candidate the model's response
   * couldn't be matched back to still gets a result
   * (`uncertain: true, confidence: 0`), never a silently missing entry a
   * caller has to notice and handle. An empty `candidates` array returns
   * an empty result array without a network call.
   */
  categorizeBatch(
    candidates: CategorizationCandidate[],
    categories: readonly string[],
  ): Promise<CategorizationResult[]>;
}
