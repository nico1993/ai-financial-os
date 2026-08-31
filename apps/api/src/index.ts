// @financial-os/api
// Fastify — all HTTP-facing routes: dashboard endpoints, Plaid webhook
// receiver, SSE stream. Entrypoint: connect to Mongo, build the app,
// start listening.
import { connectDb } from "@financial-os/db";
import { buildServer } from "./server.js";
import { startDashboardEventPublisher } from "./events/publisher.js";
import { env } from "./env.js";

async function main(): Promise<void> {
  await connectDb({ uri: env.MONGO_URI });

  // ANLY-8: starts the three QueueEvents listeners /events reads from.
  // Independent of buildServer() -- it has no Fastify dependency of its
  // own (events/publisher.ts) -- but both need to be up before this
  // process starts accepting connections.
  startDashboardEventPublisher();

  const app = await buildServer();
  await app.listen({ host: "0.0.0.0", port: env.PORT });
}

main().catch((err: unknown) => {
  console.error("apps/api failed to start:", err);
  process.exit(1);
});
