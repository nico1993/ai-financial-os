// routes/config.ts — WEB-7's sandbox-mode indicator needs to know which
// Plaid environment this deployment is running against, and it needs that
// before the user ever clicks "Connect a bank" (it's a persistent badge,
// not something scoped to the Link flow) -- so it's its own tiny route
// rather than folded into /api/auth/me (identity) or /api/plaid/link-token
// (only fetched on demand). One field today; a deliberately small, obvious
// home for any other deployment-level flag the frontend needs later.
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/requireAuth.js";
import { env } from "../env.js";

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/config", { preHandler: requireAuth }, async (_req, reply) => {
    return reply.send({ plaidEnv: env.PLAID_ENV });
  });
}
