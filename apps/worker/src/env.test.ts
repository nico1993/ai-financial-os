import { describe, it, expect } from "vitest";
import { loadEnv } from "./env.js";

function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    MONGO_URI: "mongodb://localhost:27017/test",
    REDIS_URL: "redis://localhost:6379",
    PLAID_CLIENT_ID: "client-id",
    PLAID_SECRET: "secret",
    ...overrides,
  };
}

describe("loadEnv", () => {
  it("parses a minimal valid environment", () => {
    const env = loadEnv(baseEnv());
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.PROVIDER_SYNC_CONCURRENCY).toBe(2);
  });

  it("treats an empty value as unset, not as an invalid value", () => {
    // The failure that took both processes down on the first real boot:
    // PLAID_WEBHOOK_URL= is "" from dotenv, which .url() rejects.
    const env = loadEnv(baseEnv({ PLAID_WEBHOOK_URL: "" }));
    expect(env.PLAID_WEBHOOK_URL).toBeUndefined();
  });

  it("lets an empty value fall back to the default rather than overriding it", () => {
    const env = loadEnv(baseEnv({ PROVIDER_SYNC_CONCURRENCY: "" }));
    expect(env.PROVIDER_SYNC_CONCURRENCY).toBe(2);
  });

  it("names every missing variable in one message", () => {
    let message = "";
    try {
      loadEnv({});
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("MONGO_URI");
    expect(message).toContain("REDIS_URL");
  });

  it("coerces the numeric queue knobs from their string forms", () => {
    const env = loadEnv(
      baseEnv({
        PROVIDER_SYNC_CONCURRENCY: "8",
        PROVIDER_SYNC_POLL_INTERVAL_MS: "300000",
      }),
    );
    expect(env.PROVIDER_SYNC_CONCURRENCY).toBe(8);
    expect(env.PROVIDER_SYNC_POLL_INTERVAL_MS).toBe(300_000);
  });

  it("rejects a non-positive concurrency rather than starting a worker that does nothing", () => {
    expect(() => loadEnv(baseEnv({ PROVIDER_SYNC_CONCURRENCY: "0" }))).toThrow(
      /PROVIDER_SYNC_CONCURRENCY/,
    );
  });
});
