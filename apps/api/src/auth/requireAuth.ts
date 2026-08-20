// requireAuth.ts — the preHandler hook every non-public route runs
// through (ADR-0018, AUTH-4). Exempt: /api/auth/*, the Plaid webhook
// receiver (ING-7, verified via its own JWT check instead), and /health.
import type { FastifyReply, FastifyRequest } from "fastify";

export function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void,
): void {
  if (!req.session.userId) {
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  done();
}
