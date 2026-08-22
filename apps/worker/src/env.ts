// env.ts — parses and validates process.env once at startup, so a
// missing var fails fast at boot rather than mid-job.
//
// Deliberately its own file rather than shared with apps/api: the two
// processes need overlapping-but-different config (the API needs
// SESSION_SECRET and PORT; the worker doesn't, and will grow queue
// concurrency knobs the API has no use for). Each app owning its own
// contract is cheaper than a shared abstraction that has to satisfy both.
//
// The dotenv call below is load-bearing when running on the host under
// `tsx`. In Docker, compose's `env_file:` injects real environment
// variables and this finds nothing to do; outside Docker, nothing else
// reads `.env`, so without it every var below is undefined. `override` is
// left at its default false, so a real environment variable always beats
// the file -- which is what containers and CI need.
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// `.env` lives at the repo root, but pnpm runs this with cwd set to
// apps/worker, so dotenv's default lookup would miss it. Resolved from
// this file's own location instead: apps/worker/src/env.ts -> three up.
loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PLAID_CLIENT_ID: z.string().min(1),
  PLAID_SECRET: z.string().min(1),
  PLAID_ENV: z.enum(["sandbox", "development", "production"]).default("sandbox"),
  PLAID_CLIENT_NAME: z.string().min(1).default("Personal Financial OS"),
  PLAID_WEBHOOK_URL: z.string().url().optional(),
  /** How many provider-sync jobs may run at once. Low by default: each job
   * is a multi-page Plaid drain, and Plaid rate-limits per Item and per
   * client (§2.2). ING-6 adds the queue-level limiter and backoff. */
  PROVIDER_SYNC_CONCURRENCY: z.coerce.number().int().positive().default(2),
  /** Client-side rate ceiling: at most N jobs started per window, so a
   * burst of webhooks doesn't walk straight into a Plaid 429 (§2.2). */
  PROVIDER_SYNC_RATE_MAX: z.coerce.number().int().positive().default(5),
  PROVIDER_SYNC_RATE_DURATION_MS: z.coerce.number().int().positive().default(1_000),
  /** How often the fallback poll sweeps every syncable connection (ING-8).
   * §2.2 suggests 4–6h: frequent enough that a missed webhook doesn't
   * leave data stale for a day, rare enough not to look like polling. */
  PROVIDER_SYNC_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * 60 * 60 * 1_000),
});

export type Env = z.infer<typeof envSchema>;

/** `FOO=` in a .env file arrives as the empty string, not undefined — but
 * by universal convention it means "not set". Without this, an optional
 * var left deliberately blank (PLAID_WEBHOOK_URL, which has no sensible
 * value on a laptop Plaid can't reach) fails its own validator and takes
 * the whole process down at boot, and a var with a `.default()` would be
 * overridden by "" instead of falling back. */
function withoutEmptyValues(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== "") cleaned[key] = value;
  }
  return cleaned;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(withoutEmptyValues(source));
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const env: Env = loadEnv();
