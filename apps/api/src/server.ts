// server.ts — builds the Fastify app: session plugin wiring, route
// registration, and the /health check docker-compose's SETUP-7 healthcheck
// stub was waiting on.
import Fastify, { type FastifyInstance } from "fastify";
import { registerSession } from "./auth/session.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerPlaidRoutes } from "./routes/plaid.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerTransactionRoutes } from "./routes/transactions.js";
import { registerCategoryRoutes } from "./routes/categories.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerEventsRoutes } from "./routes/events.js";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await registerSession(app);

  app.get("/health", async () => ({ status: "ok" }));

  await registerAuthRoutes(app);
  await registerPlaidRoutes(app);
  await registerAccountRoutes(app);
  await registerConfigRoutes(app);
  await registerTransactionRoutes(app);
  await registerCategoryRoutes(app);
  // Unauthenticated by design — verified via signed JWT instead (ING-7).
  await registerWebhookRoutes(app);
  await registerAnalyticsRoutes(app);
  await registerEventsRoutes(app);

  return app;
}
