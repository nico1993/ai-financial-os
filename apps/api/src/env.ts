// env.ts — parses and validates process.env once at startup; every other
// module imports `env` from here instead of touching `process.env`
// directly, so a missing/malformed var fails fast at boot with a clear
// message instead of surfacing as a cryptic error deep inside a request.
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
// apps/api, so dotenv's default lookup would miss it. Resolved from this
// file's own location instead: apps/api/src/env.ts -> three up.
loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

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

  // --- Transfer matching (XFER-7, ARCHITECTURE.md §2.4, ADR-0006, ADR-0029) ---
  // Mirrors apps/worker/src/env.ts's own copy of these two exactly
  // (deliberately not shared -- see that file's own comment on why each
  // app owns its config contract). routes/transactions.ts's suggest-
  // candidates route runs the same suggestTransferCandidates() heuristic
  // apps/worker's automated matching pass does, and a person reviewing
  // suggestions should see the same tolerance window the automated pass
  // itself uses, not a second, independently-tunable one that could
  // silently drift out of sync. Only the two tolerance knobs are needed
  // here -- XFER_MATCHING_CONCURRENCY and XFER_UNMATCHED_AGE_DAYS are
  // worker-only job-scheduling concerns apps/api has no use for.
  /** How many calendar days apart a suggested pair's dates may fall
   * (§2.4: "ACH transfers commonly settle 1-3 days apart across
   * accounts"). */
  XFER_MATCH_DATE_TOLERANCE_DAYS: z.coerce.number().int().nonnegative().default(3),
  /** How many cents a suggested pair's magnitudes may differ by, covering
   * a wire/ACH fee shaved off one side (§2.4's "near-equal, to allow for
   * a fee"). */
  XFER_MATCH_AMOUNT_TOLERANCE_CENTS: z.coerce.number().int().nonnegative().default(100),
});

export type Env = z.infer<typeof envSchema>;

/** Takes an explicit source (defaulting to `process.env`) so tests can
 * validate arbitrary env shapes without mutating the real process env. */
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
