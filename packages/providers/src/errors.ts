// Provider-neutral error taxonomy.
//
// The sync job has to react differently to "slow down" than to "this
// connection needs the user to re-authenticate" than to "your cursor is
// stale" — but AGENTS.md keeps Plaid specifics inside the adapter, so the
// worker can't switch on `error_code` or reach into an axios response.
// Each adapter translates its own failures into these types; everything
// upstream matches on them instead (ADR-0023).
//
// Only the cases a story actually consumes live here. ING-10
// (ITEM_LOGIN_REQUIRED) and ING-11 (cursor drift) add their own members.

export class ProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderError";
  }
}

/** The provider is asking us to back off (Plaid: HTTP 429). Handled by
 * pausing the whole queue rather than retrying this one job, since the
 * limit is per-client, not per-connection — see ING-6. */
export class ProviderRateLimitError extends ProviderError {
  /** From the provider's `Retry-After` header when it sends one. */
  readonly retryAfterMs?: number;

  constructor(message: string, options?: { cause?: unknown; retryAfterMs?: number }) {
    super(message, options);
    this.name = "ProviderRateLimitError";
    this.retryAfterMs = options?.retryAfterMs;
  }
}
