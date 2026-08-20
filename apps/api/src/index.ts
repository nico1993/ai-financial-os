// @financial-os/api
// Fastify — all HTTP-facing routes: dashboard endpoints, Plaid webhook
// receiver, SSE stream. Entrypoint: connect to Mongo, build the app,
// start listening.
import { connectDb } from "@financial-os/db";
import { buildServer } from "./server.js";
import { env } from "./env.js";

async function main(): Promise<void> {
  await connectDb({ uri: env.MONGO_URI });

  const app = await buildServer();
  await app.listen({ host: "0.0.0.0", port: env.PORT });
}

main().catch((err: unknown) => {
  console.error("apps/api failed to start:", err);
  process.exit(1);
});
