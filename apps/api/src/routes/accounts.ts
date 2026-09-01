// routes/accounts.ts — WEB-7: read side for "what's already linked."
// Provider-neutral route name/path (ADR-0004 -- "Connection", not "Item"),
// separate from routes/plaid.ts, which stays scoped to the Plaid Link
// flow itself (link-token creation + public-token exchange). ING-13 adds
// the manual re-sync route at the bottom -- the third caller
// queues.ts's requestProviderSync() doc comment already anticipated
// alongside the webhook and the scheduled poll.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AccountRepository, ConnectionRepository } from "@financial-os/db";
import { requireAuth } from "../auth/requireAuth.js";
import { buildAccountList } from "../accounts/list.js";
import { requestProviderSync } from "../queues.js";

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

  // ING-13: lets a user force a re-sync instead of waiting on
  // PROVIDER_SYNC_POLL_INTERVAL_MS or a webhook that may never arrive
  // locally. Read-then-compare ownership check (not a scoped repository
  // method, per TransactionRepository.updateCategoryForUser()'s doc
  // comment reasoning in ADR-0041 -- this is a one-off read, not a
  // mutation, so there's no write to fold the check into) so one user
  // can never trigger a sync on another's connection via a guessed id.
  app.post("/api/accounts/:connectionId/sync", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const params = z.object({ connectionId: z.string().min(1) }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid connection id" });
    }

    const connection = await connectionRepo.findById(params.data.connectionId);
    if (!connection || connection.userId !== userId) {
      return reply.code(404).send({ error: "connection not found" });
    }

    await requestProviderSync(connection._id.toString());
    return reply.code(202).send({ status: "queued" });
  });
}
