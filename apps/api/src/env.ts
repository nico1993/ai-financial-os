// env.ts — parses and validates process.env once at startup; every other
// module imports `env` from here instead of touching `process.env`
// directly, so a missing/malformed var fails fast at boot with a clear
// message instead of surfacing as a cryptic error deep inside a request.
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // Signs the session cookie (ADR-0018) — treat like any other secret.
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  PLAID_CLIENT_ID: z.string().min(1),
  PLAID_SECRET: z.string().min(1),
  PLAID_ENV: z.enum(["sandbox", "development", "production"]).default("sandbox"),
  PLAID_CLIENT_NAME: z.string().min(1).default("Personal Financial OS"),
  // Optional: Plaid just won't fire webhooks without it, and ING-8's
  // polling fallback covers ingestion in the meantime (plaidClient.ts).
  PLAID_WEBHOOK_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Takes an explicit source (defaulting to `process.env`) so tests can
 * validate arbitrary env shapes without mutating the real process env. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const env: Env = loadEnv();
