// PlaidProvider — the sole FinancialProvider implementation for Phase 1
// (ARCHITECTURE.md §2.1, ADR-0004). Every Plaid-specific type, field name,
// and SDK call lives in this file (and plaidClient.ts); nothing outside
// packages/providers/src/plaid should import the `plaid` package or know a
// Plaid-specific field name exists.
import { createHash } from "node:crypto";
import {
  CountryCode,
  Products,
  type AccountBase,
  type AccountType,
  type PlaidApi,
  type RemovedTransaction as PlaidRemovedTransaction,
  type Transaction as PlaidTransaction,
} from "plaid";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { withPlaidErrorMapping } from "./plaidErrors.js";
import { parsePlaidWebhook } from "./plaidWebhooks.js";
import type {
  ConnectionResult,
  CreateLinkTokenInput,
  FinancialProvider,
  ProviderWebhookEvent,
  NormalizedAccount,
  NormalizedAccountType,
  NormalizedTransaction,
  ProviderConnectionRef,
  RemovedTransaction,
  SyncTransactionsResult,
  WebhookVerificationRequest,
} from "../FinancialProvider.js";

export interface PlaidProviderConfig {
  /** Shown in the Plaid Link UI ("connect to <clientName>"). */
  clientName: string;
  /** Plaid webhook receiver URL (ING-7) — omit in local dev if no public
   * URL is reachable; Plaid just won't fire webhooks, and ING-8's polling
   * fallback covers ingestion in the meantime. */
  webhookUrl?: string;
  /** Defaults to just the US — extend when a non-US institution is ever
   * linked (out of scope per ADR-0001's single-currency MVP). */
  countryCodes?: CountryCode[];
}

/** Shape of Plaid's webhookVerificationKeyGet `key` field — kept as a local
 * interface rather than sourced from the SDK's response type so this file
 * doesn't chase a deep generic through Plaid's Axios response wrapper. */
interface PlaidVerificationKey {
  alg: string;
  created_at: number;
  expired_at: string | null;
  kid: string;
  kty: string;
  use: string;
  crv: string;
  x: string;
  y: string;
}

/** Plaid's webhook signing keys don't rotate often; Plaid's own docs
 * recommend caching by key_id rather than re-fetching on every webhook.
 * Module-level (not per-instance) since there's only ever one PlaidProvider
 * per process and the cache is harmless to share. A rotated/revoked key_id
 * simply stops being requested; `expired_at` on the cached key is still
 * checked on every verification. */
const verificationKeyCache = new Map<string, PlaidVerificationKey>();

// ING-14/ADR-0046: this app's own product ceiling for how far back a
// user can request transaction history at connect time -- 1/2/3 months,
// 3 months (90 days) as the hard max per the ticket's own wording.
// Clamped here, the one place a link token is actually built, so no
// caller (a route bug, a future second frontend) can ever ask Plaid for
// more than this app has ever offered in its own UI. Well inside Plaid's
// real `days_requested` range (1-730 days, confirmed against Plaid's
// current API docs, 2026-09-04) -- a deliberate product choice narrower
// than the platform limit, not this app straining against it.
const MIN_DAYS_REQUESTED = 30;
const MAX_DAYS_REQUESTED = 90;
const DEFAULT_DAYS_REQUESTED = 30;

function clampDaysRequested(daysRequested: number | undefined): number {
  if (daysRequested === undefined) return DEFAULT_DAYS_REQUESTED;
  return Math.min(MAX_DAYS_REQUESTED, Math.max(MIN_DAYS_REQUESTED, Math.round(daysRequested)));
}

export class PlaidProvider implements FinancialProvider {
  constructor(
    private readonly client: PlaidApi,
    private readonly config: PlaidProviderConfig,
  ) {}

  async createLinkToken(input: CreateLinkTokenInput): Promise<{ linkToken: string }> {
    return withPlaidErrorMapping(async () => {
      const response = await this.client.linkTokenCreate({
        user: { client_user_id: input.userId },
        client_name: this.config.clientName,
        products: [Products.Transactions],
        country_codes: this.config.countryCodes ?? [CountryCode.Us],
        language: "en",
        webhook: this.config.webhookUrl,
        // ADR-0046 (supersedes ADR-0002's fixed 30): caller-chosen,
        // clamped to this app's own 30-90 day ceiling above -- never
        // trusts input.daysRequested unclamped.
        transactions: { days_requested: clampDaysRequested(input.daysRequested) },
      });

      return { linkToken: response.data.link_token };
    });
  }

  async createConnection(publicToken: string): Promise<ConnectionResult> {
    return withPlaidErrorMapping(async () => {
      const exchange = await this.client.itemPublicTokenExchange({ public_token: publicToken });
      const accessToken = exchange.data.access_token;
      const providerItemId = exchange.data.item_id;

      const institutionName = await this.resolveInstitutionName(accessToken);

      const accountsResponse = await this.client.accountsGet({ access_token: accessToken });
      const accounts = accountsResponse.data.accounts.map((account) =>
        normalizeAccount(account, institutionName),
      );

      return { providerItemId, accessToken, institutionName, accounts };
    });
  }

  /** One page of the sync cursor — the pagination loop lives in the sync
   * job (ING-4), not here (ARCHITECTURE.md §2.2). */
  async syncTransactions(
    connection: ProviderConnectionRef,
    cursor: string | null,
  ): Promise<SyncTransactionsResult> {
    return withPlaidErrorMapping(async () => {
      const response = await this.client.transactionsSync({
        access_token: connection.accessToken,
        cursor: cursor ?? undefined,
      });

      return {
        added: response.data.added.map(normalizeTransaction),
        modified: response.data.modified.map(normalizeTransaction),
        removed: response.data.removed.map(normalizeRemoved),
        nextCursor: response.data.next_cursor,
        hasMore: response.data.has_more,
      };
    });
  }

  async getAccounts(connection: ProviderConnectionRef): Promise<NormalizedAccount[]> {
    return withPlaidErrorMapping(async () => {
      const institutionName = await this.resolveInstitutionName(connection.accessToken);
      const accountsResponse = await this.client.accountsGet({
        access_token: connection.accessToken,
      });
      return accountsResponse.data.accounts.map((account) =>
        normalizeAccount(account, institutionName),
      );
    });
  }

  /** AUTH-8/ADR-0047: calls Plaid's `/item/remove` -- confirmed against
   * the installed `plaid@30.1.0`'s own type declarations (ItemRemoveRequest
   * takes just `access_token`; client_id/secret are already baked into
   * every call via `plaidClient.ts`'s Configuration), the same
   * registry-check discipline every Plaid-adjacent addition in this
   * codebase already follows. Not wrapped in any extra idempotency
   * handling here -- `withPlaidErrorMapping()` already normalizes
   * whatever Plaid returns for an already-removed Item into this
   * package's own error taxonomy (ADR-0023); it's the caller's job to
   * decide an ITEM_NOT_FOUND-shaped failure here isn't fatal to the
   * larger operation it's part of (routes/auth.ts's account-deletion
   * route treats every call to this method as best-effort). */
  async removeItem(connection: ProviderConnectionRef): Promise<void> {
    return withPlaidErrorMapping(async () => {
      await this.client.itemRemove({ access_token: connection.accessToken });
    });
  }

  /** Verifies Plaid's webhook JWT (ARCHITECTURE.md §5): decode the
   * `Plaid-Verification` header's JWT to find its key id, fetch (and cache)
   * that key from Plaid, verify the ES256 signature, reject stale tokens
   * (>5 minutes old, per Plaid's own guidance), and confirm the JWT's
   * `request_body_sha256` claim matches the actual body — so a replayed or
   * tampered payload fails even with a validly-signed token. */
  async verifyWebhook(req: WebhookVerificationRequest): Promise<boolean> {
    const token = req.headers["plaid-verification"];
    if (!token) return false;

    try {
      const { kid } = decodeProtectedHeader(token);
      if (!kid) return false;

      const key = await this.getVerificationKey(kid);
      if (!key || key.expired_at) return false;

      const jwk = await importJWK(
        {
          kty: key.kty,
          crv: key.crv,
          x: key.x,
          y: key.y,
          alg: key.alg,
          use: key.use,
          kid: key.kid,
        },
        "ES256",
      );
      const { payload } = await jwtVerify(token, jwk, { algorithms: ["ES256"] });

      const issuedAtMs = typeof payload.iat === "number" ? payload.iat * 1000 : 0;
      if (Date.now() - issuedAtMs > 5 * 60 * 1000) return false;

      const bodyHash = createHash("sha256").update(req.rawBody).digest("hex");
      return payload.request_body_sha256 === bodyHash;
    } catch {
      // Any decode/verify failure (malformed token, unknown kid, bad
      // signature) means "not verified" — never throw out of this method,
      // since a hostile or malformed webhook request is exactly the input
      // it exists to handle.
      return false;
    }
  }

  parseWebhook(body: unknown): ProviderWebhookEvent {
    return parsePlaidWebhook(body);
  }

  private async resolveInstitutionName(accessToken: string): Promise<string> {
    const item = await this.client.itemGet({ access_token: accessToken });
    const institutionId = item.data.item.institution_id;
    if (!institutionId) return "Unknown institution";

    const institution = await this.client.institutionsGetById({
      institution_id: institutionId,
      country_codes: this.config.countryCodes ?? [CountryCode.Us],
    });
    return institution.data.institution.name;
  }

  private async getVerificationKey(keyId: string): Promise<PlaidVerificationKey | undefined> {
    const cached = verificationKeyCache.get(keyId);
    if (cached) return cached;

    const response = await this.client.webhookVerificationKeyGet({ key_id: keyId });
    const key = response.data.key as PlaidVerificationKey;
    verificationKeyCache.set(keyId, key);
    return key;
  }
}

function mapAccountType(type: AccountType): NormalizedAccountType {
  switch (type) {
    case "depository":
      return "depository";
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
    case "brokerage":
      return "investment";
    default:
      // Plaid's "other" bucket has no honest mapping onto our 4 types;
      // treated as depository (the common real-world case for it) rather
      // than widening NormalizedAccountType for a bucket nothing else in
      // the app reasons about yet. Revisit if this ever misclassifies a
      // real linked account.
      return "depository";
  }
}

function toCents(amount: number | null | undefined): number {
  return Math.round((amount ?? 0) * 100);
}

function normalizeAccount(account: AccountBase, institutionName: string): NormalizedAccount {
  return {
    providerAccountId: account.account_id,
    institutionName,
    type: mapAccountType(account.type),
    subtype: account.subtype ?? "other",
    officialName: account.official_name ?? undefined,
    currentBalance: toCents(account.balances.current),
    availableBalance:
      account.balances.available != null ? toCents(account.balances.available) : undefined,
    isoCurrencyCode:
      account.balances.iso_currency_code ?? account.balances.unofficial_currency_code ?? "USD",
  };
}

function normalizeTransaction(tx: PlaidTransaction): NormalizedTransaction {
  return {
    providerTransactionId: tx.transaction_id,
    pendingTransactionId: tx.pending_transaction_id ?? undefined,
    accountProviderId: tx.account_id,
    date: new Date(tx.date),
    authorizedDate: tx.authorized_date ? new Date(tx.authorized_date) : undefined,
    // Plaid convention: positive amount = money leaving the account.
    // Preserved as-is (not flipped) so every downstream consumer shares one
    // sign convention, matching Plaid's own documentation.
    amount: toCents(tx.amount),
    isoCurrencyCode: tx.iso_currency_code ?? tx.unofficial_currency_code ?? "USD",
    merchantName: tx.merchant_name ?? undefined,
    description: tx.name,
    pending: tx.pending,
    providerCategory: tx.personal_finance_category?.detailed ?? undefined,
  };
}

function normalizeRemoved(removed: PlaidRemovedTransaction): RemovedTransaction {
  return { providerTransactionId: removed.transaction_id ?? "" };
}
