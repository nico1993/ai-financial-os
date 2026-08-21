import { describe, it, expect } from "vitest";
import {
  ProviderConnectionRevokedError,
  ProviderCursorInvalidError,
  ProviderRateLimitError,
  ProviderReauthRequiredError,
  ProviderSyncMutationError,
} from "../errors.js";
import { mapPlaidError, parseRetryAfterMs, withPlaidErrorMapping } from "./plaidErrors.js";

/** An axios-shaped rejection, which is what the Plaid SDK throws. */
function plaidError(options: {
  status?: number;
  body?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}): unknown {
  return {
    message: "Request failed",
    response: {
      status: options.status,
      headers: options.headers,
      data: options.body,
    },
  };
}

describe("parseRetryAfterMs", () => {
  it("converts a Retry-After value from seconds to milliseconds", () => {
    expect(parseRetryAfterMs({ "retry-after": "30" })).toBe(30_000);
  });

  it("accepts the header in canonical casing too", () => {
    expect(parseRetryAfterMs({ "Retry-After": 5 })).toBe(5_000);
  });

  it("returns undefined when the header is absent", () => {
    expect(parseRetryAfterMs({})).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });

  it("returns undefined rather than NaN for an unparseable value", () => {
    // A NaN backoff would otherwise be passed straight to a timer.
    expect(parseRetryAfterMs({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" })).toBeUndefined();
    expect(parseRetryAfterMs({ "retry-after": "-3" })).toBeUndefined();
  });
});

describe("mapPlaidError", () => {
  it("maps HTTP 429 to ProviderRateLimitError", () => {
    const mapped = mapPlaidError(plaidError({ status: 429 }));
    expect(mapped).toBeInstanceOf(ProviderRateLimitError);
  });

  it("maps a RATE_LIMIT_EXCEEDED body even without a 429 status", () => {
    const mapped = mapPlaidError(
      plaidError({ status: 400, body: { error_type: "RATE_LIMIT_EXCEEDED" } }),
    );
    expect(mapped).toBeInstanceOf(ProviderRateLimitError);
  });

  it("carries Retry-After onto the mapped error", () => {
    const mapped = mapPlaidError(plaidError({ status: 429, headers: { "retry-after": "12" } }));
    expect((mapped as ProviderRateLimitError).retryAfterMs).toBe(12_000);
  });

  it("keeps the provider's message and the original error as cause", () => {
    const original = plaidError({
      status: 429,
      body: { error_message: "too many requests for this client" },
    });
    const mapped = mapPlaidError(original);
    expect(mapped?.message).toBe("too many requests for this client");
    expect(mapped?.cause).toBe(original);
  });

  it("returns undefined for errors nothing upstream treats specially", () => {
    expect(mapPlaidError(plaidError({ status: 500 }))).toBeUndefined();
    expect(
      mapPlaidError(plaidError({ status: 400, body: { error_code: "INTERNAL_SERVER_ERROR" } })),
    ).toBeUndefined();
  });
});

describe("mapPlaidError — item state (ING-10)", () => {
  it("maps ITEM_LOGIN_REQUIRED to a re-auth error", () => {
    const mapped = mapPlaidError(
      plaidError({ status: 400, body: { error_code: "ITEM_LOGIN_REQUIRED" } }),
    );
    expect(mapped).toBeInstanceOf(ProviderReauthRequiredError);
  });

  it("maps revoked-access codes to a revoked error, not a re-auth one", () => {
    // The distinction matters: re-auth is a Link update-mode flow, revoked
    // means the connection has to be created again from scratch.
    for (const code of ["USER_PERMISSION_REVOKED", "ITEM_NOT_FOUND"]) {
      const mapped = mapPlaidError(plaidError({ status: 400, body: { error_code: code } }));
      expect(mapped).toBeInstanceOf(ProviderConnectionRevokedError);
    }
  });
});

describe("mapPlaidError — cursor drift (ING-11)", () => {
  it("maps a mutation-during-pagination to its own error, NOT an invalid cursor", () => {
    // Conflating these would throw away a perfectly good cursor and force
    // a full resync when restarting the drain would have been enough.
    const mapped = mapPlaidError(
      plaidError({
        status: 400,
        body: { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" },
      }),
    );
    expect(mapped).toBeInstanceOf(ProviderSyncMutationError);
    expect(mapped).not.toBeInstanceOf(ProviderCursorInvalidError);
  });

  it("maps an unusable cursor to ProviderCursorInvalidError", () => {
    const mapped = mapPlaidError(
      plaidError({ status: 400, body: { error_code: "TRANSACTIONS_SYNC_INVALID_CURSOR" } }),
    );
    expect(mapped).toBeInstanceOf(ProviderCursorInvalidError);
  });

  it("does not throw on errors that aren't HTTP-shaped at all", () => {
    expect(mapPlaidError(new Error("socket hang up"))).toBeUndefined();
    expect(mapPlaidError(undefined)).toBeUndefined();
    expect(mapPlaidError("a string")).toBeUndefined();
    expect(mapPlaidError({ response: null })).toBeUndefined();
  });
});

describe("withPlaidErrorMapping", () => {
  it("passes a successful result straight through", async () => {
    expect(await withPlaidErrorMapping(async () => "ok")).toBe("ok");
  });

  it("throws the mapped error for a recognized failure", async () => {
    await expect(
      withPlaidErrorMapping(() => Promise.reject(plaidError({ status: 429 }))),
    ).rejects.toBeInstanceOf(ProviderRateLimitError);
  });

  it("rethrows the ORIGINAL error when there is no mapping", async () => {
    // Preserving the original keeps its stack and message intact rather
    // than flattening every failure into a generic provider wrapper.
    const original = new Error("socket hang up");
    await expect(withPlaidErrorMapping(() => Promise.reject(original))).rejects.toBe(original);
  });
});
