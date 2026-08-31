// routes/accounts.ts — WEB-7: read side for "what's already linked."
// Provider-neutral route name/path (ADR-0004 -- "Connection", not "Item"),
// separate from routes/plaid.ts, which stays scoped to the Plaid Link
// flow itself (link-token creation + public-token exchange).
import type { FastifyInstance } from "fastify";
import { AccountRepository, ConnectionRepository } from "@financial-os/db";
import { requireAuth } from "../auth/requireAuth.js";
import { buildAccountList } from "../accounts/list.js";

const accountRepo = new AccountRepository();
const connectionRepo = new ConnectionRepository();

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/accounts", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const [accounts, connections] = await Promise.all([
      accountRepo.findByUserId(userId),
      connectionRepo.findByUserId(userId),
    ]);
    return reply.send(buildAccountList(accounts, connections));
  });
}
