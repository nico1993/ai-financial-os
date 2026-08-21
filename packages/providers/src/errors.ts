// Provider-neutral error taxonomy.
//
// The sync job has to react differently to "slow down" than to "this
// connection needs the user to re-authenticate" than to "your cursor is
// stale" — but AGENTS.md keeps Plaid specifics inside the adapter, so the
// worker can't switch on `error_code` or reach into an axios response.
// Each adapter translates its own failures into these types; everything
// upstream matches on them instead (ADR-0023).
//
// Only the cases a story actually consumes live here.

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

/** The connection needs the user to log in again before it will sync
 * (Plaid: ITEM_LOGIN_REQUIRED). Not retryable by us at all — retrying
 * burns rate-limit budget against an Item that cannot succeed until a
 * human re-authenticates (§6, ING-10). Maps to
 * `Connection.status = "login_required"`. */
export class ProviderReauthRequiredError extends ProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderReauthRequiredError";
  }
}

/** The connection is gone for good — access revoked, or the provider no
 * longer recognizes the item. Re-auth won't fix it; the user has to link
 * again. Maps to `Connection.status = "error"` (ING-10). */
export class ProviderConnectionRevokedError extends ProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderConnectionRevokedError";
  }
}

/** The stored cursor is no longer usable — e.g. after a long outage or an
 * Item re-link. Recovery is a full resync from an empty cursor, not a
 * retry (§6, ING-11). */
export class ProviderCursorInvalidError extends ProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderCursorInvalidError";
  }
}

/** The underlying data changed while we were paginating, so the pages
 * fetched so far no longer form a consistent view (Plaid:
 * TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION). Recovery is to restart
 * the drain from the cursor this run began with — NOT a full resync, and
 * NOT a plain retry of the failed page (§6, ING-11). */
export class ProviderSyncMutationError extends ProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderSyncMutationError";
  }
}
