import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, getApiErrorMessage } from "./client";

// Test-first per AGENTS.md's convention, applied to apps/web's own
// pure-enough logic (WEB-6): apiFetch's status/body handling is a plain
// function of a Response, so it's tested against real `Response` objects
// (Node's built-in fetch globals) rather than a hand-rolled fake shape.
describe("apiFetch", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("always sends credentials: 'include'", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await apiFetch("/api/auth/me");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("JSON-encodes a plain object body and sets Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "u1" }), { status: 200 }));

    await apiFetch("/api/auth/login", {
      method: "POST",
      body: { email: "a@b.com", password: "x" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ email: "a@b.com", password: "x" }));
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
  });

  it("passes a string body through untouched, without a Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await apiFetch("/api/webhooks/plaid", { method: "POST", body: "raw-text" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe("raw-text");
    expect((init.headers as Headers).get("Content-Type")).toBeNull();
  });

  it("parses a JSON success body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "u1", email: "a@b.com" }), { status: 200 }),
    );

    const result = await apiFetch<{ id: string; email: string }>("/api/auth/me");

    expect(result).toEqual({ id: "u1", email: "a@b.com" });
  });

  it("resolves to undefined on 204 No Content (logout)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await apiFetch("/api/auth/logout", { method: "POST" });

    expect(result).toBeUndefined();
  });

  it("throws ApiError with the parsed body and status on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid email or password" }), { status: 401 }),
    );

    await expect(apiFetch("/api/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
      status: 401,
      body: { error: "invalid email or password" },
    });
  });

  it("throws ApiError even when a non-ok response body isn't JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));

    const error = await apiFetch("/api/auth/me").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).body).toBe("Internal Server Error");
  });

  it("resolves to undefined on 205 Reset Content too", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 205 }));

    await expect(apiFetch("/api/whatever")).resolves.toBeUndefined();
  });
});

describe("getApiErrorMessage", () => {
  it("unwraps apps/api's {error} shape", () => {
    const error = new ApiError(401, { error: "invalid email or password" });
    expect(getApiErrorMessage(error, "fallback")).toBe("invalid email or password");
  });

  it("falls back for a non-ApiError", () => {
    expect(getApiErrorMessage(new Error("network down"), "fallback")).toBe("fallback");
  });

  it("falls back when the ApiError body has no {error} string", () => {
    const error = new ApiError(500, "Internal Server Error");
    expect(getApiErrorMessage(error, "fallback")).toBe("fallback");
  });
});
