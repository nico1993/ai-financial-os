// Translates a Plaid webhook body into the provider-neutral event the app
// layer switches on (ADR-0024). Pure and total: it reads an `unknown` and
// always returns an event, never throws — the input arrives from the
// public internet, and a malformed body is an expected case, not an
// exception.
import type { ProviderItemErrorKind, ProviderWebhookEvent } from "../FinancialProvider.js";

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Same split as plaidErrors.ts, for the codes that arrive by webhook
 * instead of as an API failure: re-auth is a Link update-mode flow, while
 * revoked means the connection has to be created again from scratch. */
const REAUTH_REQUIRED_CODES = new Set(["ITEM_LOGIN_REQUIRED", "ITEM_LOCKED", "PENDING_EXPIRATION"]);
const REVOKED_CODES = new Set([
  "USER_PERMISSION_REVOKED",
  "USER_ACCOUNT_REVOKED",
  "ITEM_NOT_FOUND",
  "ACCESS_NOT_GRANTED",
]);

function itemErrorKind(code: string): ProviderItemErrorKind | undefined {
  if (REAUTH_REQUIRED_CODES.has(code)) return "reauth_required";
  if (REVOKED_CODES.has(code)) return "revoked";
  return undefined;
}

export function parsePlaidWebhook(body: unknown): ProviderWebhookEvent {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { type: "ignored", reason: "webhook body was not an object" };
  }

  const record = body as Record<string, unknown>;
  const webhookType = readString(record, "webhook_type") ?? "UNKNOWN";
  const webhookCode = readString(record, "webhook_code") ?? "UNKNOWN";
  const itemId = readString(record, "item_id");

  if (webhookType === "TRANSACTIONS" && webhookCode === "SYNC_UPDATES_AVAILABLE") {
    if (!itemId) {
      return { type: "ignored", reason: "SYNC_UPDATES_AVAILABLE without an item_id" };
    }
    return { type: "sync_updates_available", providerItemId: itemId };
  }

  if (webhookType === "ITEM" && itemId) {
    // Plaid signals item trouble two ways: an ERROR webhook carrying a
    // nested `error.error_code`, and dedicated codes like
    // PENDING_EXPIRATION / USER_PERMISSION_REVOKED in webhook_code itself.
    const nestedError =
      typeof record.error === "object" && record.error !== null
        ? (record.error as Record<string, unknown>)
        : undefined;
    const errorCode = nestedError ? readString(nestedError, "error_code") : undefined;
    const code = errorCode ?? webhookCode;
    const kind = itemErrorKind(code);

    if (kind) {
      const detail = nestedError ? (readString(nestedError, "error_message") ?? code) : code;
      return { type: "item_error", providerItemId: itemId, kind, detail };
    }
    // Other ITEM webhooks (LOGIN_REPAIRED, NEW_ACCOUNTS_AVAILABLE,
    // WEBHOOK_UPDATE_ACKNOWLEDGED) fall through to `ignored` below.
  }

  // Everything else is acknowledged and dropped, with the codes preserved
  // in the reason so an unexpected one shows up in logs rather than
  // vanishing. Legacy TRANSACTIONS codes (INITIAL_UPDATE,
  // HISTORICAL_UPDATE, DEFAULT_UPDATE) land here by design: they belong to
  // the /transactions/get flow, and we use /transactions/sync (§2.2), so
  // receiving one means something is misconfigured and guessing at intent
  // would be worse than ignoring it.
  return { type: "ignored", reason: `unhandled webhook ${webhookType}/${webhookCode}` };
}
