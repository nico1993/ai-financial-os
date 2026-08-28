// Provider-neutral error for CategorizationProvider (ADR-0026) -- mirrors
// errors.ts's approach for FinancialProvider (ADR-0023), scoped to the one
// case CAT-4 actually needs to react to differently. A response that came
// back but was malformed is NOT an error here -- CategorizationProvider's
// contract absorbs that into CategorizationResult.uncertain instead (see
// CategorizationProvider.ts and ollama/ollamaResponseParsing.ts). This
// type is only for "nothing came back at all."
export class CategorizationProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CategorizationProviderError";
  }
}

/** The provider could not be reached -- connection refused, DNS failure,
 * or a timeout before any response arrived. Distinct from a response that
 * arrived malformed: this means the request never completed, so retrying
 * via BullMQ's backoff is the right response, not treating the batch as
 * uncategorizable. The most common real cause locally is `ollama serve`
 * simply not running yet. */
export class CategorizationProviderUnavailableError extends CategorizationProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CategorizationProviderUnavailableError";
  }
}
