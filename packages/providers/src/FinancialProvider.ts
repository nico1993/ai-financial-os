// FinancialProvider — the interface every ingestion/categorization code
// calls, never a provider SDK directly (ARCHITECTURE.md §2.1, ADR-0004).
// Plaid is the only implementation for Phase 1 (plaid/PlaidProvider.ts),
// but nothing outside that adapter should import the `plaid` package or
// know a Plaid-specific field name exists.

export type NormalizedAccountType = "depository" | "credit" | "loan" | "investment";

export interface NormalizedAccount {
  providerAccountId: string;
  institutionName: string;
  type: NormalizedAccountType;
  subtype: string;
  officialName?: string;
  /** Integer cents, never float. */
  currentBalance: number;
  availableBalance?: number;
  isoCurrencyCode: string;
}

export interface NormalizedTransaction {
  providerTransactionId: string;
  /** For pending→posted reconciliation (ARCHITECTURE.md §6). */
  pendingTransactionId?: string;
  /** Resolves to a NormalizedAccount.providerAccountId — the sync job maps
   * this to an internal accountId via AccountRepository before writing. */
  accountProviderId: string;
  date: Date;
  authorizedDate?: Date;
  /** Integer cents, never float. */
  amount: number;
  isoCurrencyCode: string;
  merchantName?: string;
  description: string;
  pending: boolean;
  /** The provider's own category signal (e.g. Plaid's
   * personal_finance_category.detailed), passed through unparsed so the
   * transfer-matching pass (§2.4) can read TRANSFER_-prefixed/payment-type
   * values without this layer knowing Plaid's taxonomy. */
  providerCategory?: string;
}

export interface RemovedTransaction {
  providerTransactionId: string;
}

export interface ConnectionResult {
  providerItemId: string;
  accessToken: string;
  institutionName: string;
  accounts: NormalizedAccount[];
}

/** Enough for an adapter to resolve back to its provider-specific item —
 * e.g. Plaid's access_token — without the app layer knowing the provider's
 * credential shape. Sourced from Connection.providerItemId/accessToken
 * (packages/db), fetched via ConnectionRepository.findByIdWithAccessToken(). */
export interface ProviderConnectionRef {
  providerItemId: string;
  accessToken: string;
}

export interface SyncTransactionsResult {
  added: NormalizedTransaction[];
  modified: NormalizedTransaction[];
  removed: RemovedTransaction[];
  nextCursor: string;
  hasMore: boolean;
}

/** Framework-agnostic shape a webhook route hands to verifyWebhook() — not
 * tied to Fastify's request type, since packages/providers shouldn't
 * depend on apps/api. The route (ING-7) is responsible for extracting
 * these from the real request. */
export interface WebhookVerificationRequest {
  rawBody: string;
  headers: Record<string, string | undefined>;
}

/** How a connection has broken, in provider-neutral terms — mirrors the
 * error taxonomy in errors.ts, but arriving by webhook rather than as a
 * thrown API failure (ING-10). */
export type ProviderItemErrorKind = "reauth_required" | "revoked";

/** A webhook, reduced to what the app layer can act on without knowing a
 * single provider-specific code (ADR-0024). `ignored` carries a
 * human-readable reason purely so an unexpected webhook shows up in logs
 * instead of vanishing. */
export type ProviderWebhookEvent =
  | { type: "sync_updates_available"; providerItemId: string }
  | { type: "item_error"; providerItemId: string; kind: ProviderItemErrorKind; detail: string }
  | { type: "ignored"; reason: string };

export interface CreateLinkTokenInput {
  /** Plaid's user.client_user_id — opaque, just needs to be stable per user. */
  userId: string;
  /** ING-14/ADR-0046: how many days of transaction history to request at
   * Link initialization (Plaid's own `days_requested` unit) -- supersedes
   * ADR-0002's original fixed-30-day cap now that the user picks it
   * (1/2/3 months) at connect time. Optional: omitted keeps the
   * adapter's own default (still 30 days, unchanged). Whatever value
   * reaches the adapter is clamped there to this app's own product
   * ceiling regardless of what a caller passes -- see PlaidProvider's
   * own comment for the exact bounds and why they're narrower than
   * Plaid's real 1-730 day range. */
  daysRequested?: number;
}

export interface FinancialProvider {
  /** Initializes a Link session for the frontend (ADR-0017 — not in the
   * original §2.1 sketch, but AGENTS.md requires every Plaid call to go
   * through this interface, and Link can't start without one). ADR-0046
   * (supersedes ADR-0002): the backfill window is caller-chosen via
   * `input.daysRequested`, clamped server-side to this app's own 30-90
   * day product ceiling regardless of what's passed in — never Plaid's
   * own wider 1-730 day range unclamped. */
  createLinkToken(input: CreateLinkTokenInput): Promise<{ linkToken: string }>;
  /** Exchanges a Link `public_token` for a durable connection: creates the
   * access token, resolves the institution name, and fetches the initial
   * account list. */
  createConnection(publicToken: string): Promise<ConnectionResult>;
  /** One page of the provider's sync cursor. The pagination loop (calling
   * this repeatedly while hasMore is true, persisting nextCursor after
   * each page) lives in the sync job (ING-4), not here (§2.2). */
  syncTransactions(
    connection: ProviderConnectionRef,
    cursor: string | null,
  ): Promise<SyncTransactionsResult>;
  getAccounts(connection: ProviderConnectionRef): Promise<NormalizedAccount[]>;
  /** Verifies a webhook actually came from the provider before its payload
   * is trusted (ARCHITECTURE.md §5 — the webhook endpoint is
   * internet-reachable). */
  verifyWebhook(req: WebhookVerificationRequest): Promise<boolean>;
  /** Reduces a verified webhook body to a provider-neutral event, so the
   * receiving route never reads a Plaid `webhook_code` (ADR-0024). Total
   * by contract: unrecognized or malformed bodies come back as `ignored`
   * rather than throwing. Call only after verifyWebhook() passes. */
  parseWebhook(body: unknown): ProviderWebhookEvent;
}
