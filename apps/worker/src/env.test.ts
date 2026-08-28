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

  it("defaults Ollama config to a host dev setup with no API key required", () => {
    const env = loadEnv(baseEnv());
    expect(env.OLLAMA_HOST).toBe("http://localhost:11434");
    expect(env.OLLAMA_MODEL).toBe("gpt-oss:20b");
  });

  it("lets OLLAMA_HOST be overridden for the Docker Compose network", () => {
    const env = loadEnv(baseEnv({ OLLAMA_HOST: "http://host.docker.internal:11434" }));
    expect(env.OLLAMA_HOST).toBe("http://host.docker.internal:11434");
  });

  it("lets OLLAMA_MODEL be swapped without any other config change", () => {
    // The whole point of CategorizationProvider (ADR-0026): picking a
    // different model is a one-var change, not a code change.
    const env = loadEnv(baseEnv({ OLLAMA_MODEL: "llama3.1:70b" }));
    expect(env.OLLAMA_MODEL).toBe("llama3.1:70b");
  });

  it("defaults the categorize-llm batch size, confidence threshold, and concurrency", () => {
    const env = loadEnv(baseEnv());
    expect(env.CATEGORIZE_LLM_BATCH_SIZE).toBe(30);
    expect(env.CATEGORIZE_LLM_CONFIDENCE_THRESHOLD).toBe(0.7);
    expect(env.CATEGORIZE_LLM_CONCURRENCY).toBe(1);
  });

  it("coerces the categorize-llm numeric knobs from their string forms", () => {
    const env = loadEnv(
      baseEnv({
        CATEGORIZE_LLM_BATCH_SIZE: "50",
        CATEGORIZE_LLM_CONFIDENCE_THRESHOLD: "0.85",
        CATEGORIZE_LLM_CONCURRENCY: "2",
      }),
    );
    expect(env.CATEGORIZE_LLM_BATCH_SIZE).toBe(50);
    expect(env.CATEGORIZE_LLM_CONFIDENCE_THRESHOLD).toBe(0.85);
    expect(env.CATEGORIZE_LLM_CONCURRENCY).toBe(2);
  });

  it("rejects a confidence threshold outside 0..1", () => {
    expect(() => loadEnv(baseEnv({ CATEGORIZE_LLM_CONFIDENCE_THRESHOLD: "1.5" }))).toThrow(
      /CATEGORIZE_LLM_CONFIDENCE_THRESHOLD/,
    );
  });

  it("rejects a non-positive categorize-llm batch size", () => {
    expect(() => loadEnv(baseEnv({ CATEGORIZE_LLM_BATCH_SIZE: "0" }))).toThrow(
      /CATEGORIZE_LLM_BATCH_SIZE/,
    );
  });
});
