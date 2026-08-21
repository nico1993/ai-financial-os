import { describe, it, expect } from "vitest";
import { parsePlaidWebhook } from "./plaidWebhooks.js";

describe("parsePlaidWebhook", () => {
  it("maps SYNC_UPDATES_AVAILABLE to a sync trigger carrying the item id", () => {
    const event = parsePlaidWebhook({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "item-abc",
      initial_update_complete: true,
      historical_update_complete: false,
      environment: "sandbox",
    });

    expect(event).toEqual({ type: "sync_updates_available", providerItemId: "item-abc" });
  });

  it("ignores TRANSACTIONS codes belonging to the legacy /transactions/get flow", () => {
    // We use /transactions/sync (§2.2), so Plaid sends
    // SYNC_UPDATES_AVAILABLE. These arriving at all would mean something
    // is misconfigured, and acting on them would be guesswork.
    for (const code of ["INITIAL_UPDATE", "HISTORICAL_UPDATE", "DEFAULT_UPDATE"]) {
      const event = parsePlaidWebhook({
        webhook_type: "TRANSACTIONS",
        webhook_code: code,
        item_id: "item-abc",
      });
      expect(event.type).toBe("ignored");
    }
  });

  it("maps an ITEM ERROR webhook's nested error_code to a re-auth item error", () => {
    const event = parsePlaidWebhook({
      webhook_type: "ITEM",
      webhook_code: "ERROR",
      item_id: "item-abc",
      error: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "the user must log in again" },
    });

    expect(event).toEqual({
      type: "item_error",
      providerItemId: "item-abc",
      kind: "reauth_required",
      detail: "the user must log in again",
    });
  });

  it("maps revocation to kind 'revoked' rather than 'reauth_required'", () => {
    // Re-auth is a Link update-mode flow; revoked means the connection has
    // to be created again, so the two must not collapse into one state.
    const event = parsePlaidWebhook({
      webhook_type: "ITEM",
      webhook_code: "USER_PERMISSION_REVOKED",
      item_id: "item-abc",
    });

    expect(event.type).toBe("item_error");
    if (event.type === "item_error") expect(event.kind).toBe("revoked");
  });

  it("treats PENDING_EXPIRATION as needing re-auth before it lapses", () => {
    const event = parsePlaidWebhook({
      webhook_type: "ITEM",
      webhook_code: "PENDING_EXPIRATION",
      item_id: "item-abc",
    });

    expect(event.type).toBe("item_error");
    if (event.type === "item_error") expect(event.kind).toBe("reauth_required");
  });

  it("ignores ITEM webhooks that aren't failures", () => {
    for (const code of [
      "LOGIN_REPAIRED",
      "NEW_ACCOUNTS_AVAILABLE",
      "WEBHOOK_UPDATE_ACKNOWLEDGED",
    ]) {
      const event = parsePlaidWebhook({
        webhook_type: "ITEM",
        webhook_code: code,
        item_id: "item-abc",
      });
      expect(event.type).toBe("ignored");
    }
  });

  it("treats a SYNC_UPDATES_AVAILABLE without an item_id as unusable", () => {
    // There is nothing to enqueue without an item id, and defaulting to
    // 'sync everything' on a malformed unauthenticated-ish payload would
    // be a gift to anyone who got past verification.
    const event = parsePlaidWebhook({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
    });

    expect(event.type).toBe("ignored");
  });

  it("does not throw on payloads that aren't shaped like webhooks at all", () => {
    expect(parsePlaidWebhook(null).type).toBe("ignored");
    expect(parsePlaidWebhook(undefined).type).toBe("ignored");
    expect(parsePlaidWebhook("nonsense").type).toBe("ignored");
    expect(parsePlaidWebhook([]).type).toBe("ignored");
    expect(parsePlaidWebhook({ webhook_type: 42, webhook_code: {} }).type).toBe("ignored");
  });
});
