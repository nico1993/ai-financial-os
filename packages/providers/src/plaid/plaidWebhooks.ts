// Translates a Plaid webhook body into the provider-neutral event the app
// layer switches on (ADR-0024). Pure and total: it reads an `unknown` and
// always returns an event, never throws — the input arrives from the
// public internet, and a malformed body is an expected case, not an
// exception.
import type { ProviderWebhookEvent } from "../FinancialProvider.js";

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

  // Everything else is acknowledged and dropped, with the codes preserved
  // in the reason so an unexpected one shows up in logs rather than
  // vanishing. Two groups are deliberately here:
  //   - Legacy TRANSACTIONS codes (INITIAL_UPDATE, HISTORICAL_UPDATE,
  //     DEFAULT_UPDATE) belong to the /transactions/get flow; we use
  //     /transactions/sync (§2.2), so receiving one means something is
  //     misconfigured and guessing at intent would be worse than ignoring.
  //   - ITEM webhooks (ERROR, PENDING_EXPIRATION, USER_PERMISSION_REVOKED)
  //     are ING-10's job: they change Connection.status rather than
  //     triggering a sync.
  return { type: "ignored", reason: `unhandled webhook ${webhookType}/${webhookCode}` };
}
