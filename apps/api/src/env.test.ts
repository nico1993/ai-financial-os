import { describe, it, expect } from "vitest";
import { loadEnv } from "./env.js";

/** A minimal valid environment, so each test can vary one thing. */
function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    MONGO_URI: "mongodb://localhost:27017/test",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "x".repeat(32),
    PLAID_CLIENT_ID: "client-id",
    PLAID_SECRET: "secret",
    ...overrides,
  };
}

describe("loadEnv", () => {
  it("parses a minimal valid environment", () => {
    const env = loadEnv(baseEnv());
    expect(env.MONGO_URI).toBe("mongodb://localhost:27017/test");
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
  });

  it("treats an empty value as unset, not as an invalid value", () => {
    // `PLAID_WEBHOOK_URL=` in a .env file arrives as "", which is not a
    // valid URL -- so without normalization an optional var left blank on
    // purpose takes the whole process down at boot.
    const env = loadEnv(baseEnv({ PLAID_WEBHOOK_URL: "" }));
    expect(env.PLAID_WEBHOOK_URL).toBeUndefined();
  });

  it("lets an empty value fall back to the default rather than overriding it", () => {
    const env = loadEnv(baseEnv({ PLAID_ENV: "", PLAID_CLIENT_NAME: "" }));
    expect(env.PLAID_ENV).toBe("sandbox");
    expect(env.PLAID_CLIENT_NAME).toBe("Personal Financial OS");
  });

  it("still accepts a real webhook URL", () => {
    const env = loadEnv(baseEnv({ PLAID_WEBHOOK_URL: "https://example.com/api/webhooks/plaid" }));
    expect(env.PLAID_WEBHOOK_URL).toBe("https://example.com/api/webhooks/plaid");
  });

  it("still rejects a malformed webhook URL", () => {
    expect(() => loadEnv(baseEnv({ PLAID_WEBHOOK_URL: "not-a-url" }))).toThrow(/PLAID_WEBHOOK_URL/);
  });

  it("names every missing variable in one message", () => {
    // Boot failures should be fixable in one pass, not one var at a time.
    let message = "";
    try {
      loadEnv({});
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("MONGO_URI");
    expect(message).toContain("REDIS_URL");
    expect(message).toContain("SESSION_SECRET");
  });

  it("rejects a SESSION_SECRET that is too short to be worth signing with", () => {
    expect(() => loadEnv(baseEnv({ SESSION_SECRET: "short" }))).toThrow(/SESSION_SECRET/);
  });

  it("coerces PORT from its string form", () => {
    expect(loadEnv(baseEnv({ PORT: "8080" })).PORT).toBe(8080);
  });
});
