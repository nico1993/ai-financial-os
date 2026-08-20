// server.ts — builds the Fastify app: session plugin wiring, route
// registration, and the /health check docker-compose's SETUP-7 healthcheck
// stub was waiting on.
import Fastify, { type FastifyInstance } from "fastify";
import { registerSession } from "./auth/session.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerPlaidRoutes } from "./routes/plaid.js";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await registerSession(app);

  app.get("/health", async () => ({ status: "ok" }));

  await registerAuthRoutes(app);
  await registerPlaidRoutes(app);

  return app;
}
