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

const renameAccountSchema = z.object({
  // No .min(1) -- an empty string is a valid, meaningful input here (it
  // clears the nickname), unlike every other z.string().min(1) elsewhere
  // in this file/app that treats an empty value as invalid.
  nickname: z.string().max(120),
});

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

  // ACCT-1: rename a linked account. Same ownership-scoped-repository-
  // method pattern CategoryRepository.update()/TransactionRepository.
  // updateCategoryForUser() already established elsewhere -- the route
  // just parses input and 404s on no match, all the actual
  // {_id, userId} scoping lives in AccountRepository.updateNickname().
  // An empty/whitespace-only `nickname` clears it back to the provider
  // name (nickname: null -> $unset) rather than being rejected, so
  // "reset to the bank's name" is just clearing the field, not a
  // separate action.
  app.patch("/api/accounts/:id", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const params = z.object({ id: z.string().min(1) }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid account id" });
    }
    const body = renameAccountSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid input" });
    }

    const trimmed = body.data.nickname.trim();
    const updated = await accountRepo.updateNickname(
      userId,
      params.data.id,
      trimmed.length > 0 ? trimmed : null,
    );
    if (!updated) {
      return reply.code(404).send({ error: "account not found" });
    }

    return reply.send({ id: updated._id.toString(), nickname: updated.nickname ?? null });
  });
}
