// routes/events.ts — ANLY-8's SSE stream (ARCHITECTURE.md §4.3, ADR-0007,
// ADR-0037). Registered at `/events`, not under `/api` -- matching
// apps/web's vite dev-server proxy (WEB-1/WEB-3, `vite.config.ts`'s
// `server.proxy`) and the Caddyfile's own routing for the containerized
// setup, both of which already carve `/events` out as its own path
// alongside `/api`.
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/requireAuth.js";
import { subscribeToDashboardEvents, type DashboardEvent } from "../events/publisher.js";

/** How often a comment-only keepalive line is written. SSE connections
 * sit open indefinitely with nothing to say for long stretches (the user
 * just has the dashboard open, no sync running) -- without a periodic
 * write, an idle proxy/load balancer between the browser and this server
 * can time the connection out and the browser won't notice until its next
 * real event never arrives. A `:`-prefixed line is a valid SSE comment:
 * the EventSource spec requires clients to ignore it, so this never
 * reaches ANLY-10's event handler as a message. */
const HEARTBEAT_INTERVAL_MS = 30_000;

export async function registerEventsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/events", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Nginx-compatible convention (harmless elsewhere): tells a
      // buffering reverse proxy not to hold this response.
      "X-Accel-Buffering": "no",
    });
    // Tells Fastify a response is being sent manually -- without this,
    // Fastify's own reply lifecycle would try to also end the response
    // once this handler's promise resolves, which is never (the
    // connection stays open until the client disconnects).
    reply.hijack();

    const send = (event: DashboardEvent): void => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    // An immediate comment line, not a real event: gives the browser's
    // EventSource an initial byte to fire its `open` handler on promptly,
    // rather than waiting for this user's first real dashboard event
    // (which, on a quiet day, might be hours away).
    reply.raw.write(":connected\n\n");

    const unsubscribe = subscribeToDashboardEvents((event) => {
      if (event.userId === userId) send(event);
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(":heartbeat\n\n");
    }, HEARTBEAT_INTERVAL_MS);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
