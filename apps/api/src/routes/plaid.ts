// routes/plaid.ts — Plaid Link flow (ING-3): link-token creation and
// public-token exchange. Every route here requires auth (AUTH-4) -- the
// resolved session userId is what the Connection/Account records get
// written against, and it's the same value passed to createLinkToken so
// Plaid's Link session and the eventual Connection line up.
//
// ING-13: the exchange handler also requests an immediate provider-sync
// job (see the comment at its call site below) -- createConnection()
// only ever fetches accounts/balances (packages/providers/src/plaid/
// PlaidProvider.ts), never transactions. Before this, nothing pulled
// transaction history in until Plaid's webhook fired (disabled for local
// dev, PLAID_WEBHOOK_URL unset) or ING-8's scheduled poll next ran (up to
// PROVIDER_SYNC_POLL_INTERVAL_MS later) -- a freshly linked account sat
// with a balance and zero transactions, with nothing in the UI to
// explain why.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AccountRepository, ConnectionRepository } from "@financial-os/db";
import { requireAuth } from "../auth/requireAuth.js";
import { getFinancialProvider } from "../provider.js";
import { requestProviderSync } from "../queues.js";

const exchangeSchema = z.object({
  publicToken: z.string().min(1),
});

// ING-14: 1/2/3 months, matching WalletsSection.tsx's own dropdown
// (30/60/90) -- PlaidProvider clamps to this same range again
// regardless, so this schema is about giving a caller a real 400
// instead of a silently-clamped surprise, not the only enforcement.
const linkTokenSchema = z
  .object({
    daysRequested: z.number().int().min(30).max(90).optional(),
  })
  .optional();

const connectionRepo = new ConnectionRepository();
const accountRepo = new AccountRepository();

export async function registerPlaidRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/plaid/link-token", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const parsed = linkTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid input" });
    }
    const { linkToken } = await getFinancialProvider().createLinkToken({
      userId,
      daysRequested: parsed.data?.daysRequested,
    });
    return reply.send({ linkToken });
  });

  app.post("/api/plaid/exchange", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const parsed = exchangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid input" });
    }

    const result = await getFinancialProvider().createConnection(parsed.data.publicToken);

    const connection = await connectionRepo.upsertFromSync({
      userId,
      provider: "plaid",
      providerItemId: result.providerItemId,
      accessToken: result.accessToken,
      institutionName: result.institutionName,
    });

    const accounts = await Promise.all(
      result.accounts.map((account) =>
        accountRepo.upsertFromSync({
          userId,
          connectionId: connection._id,
          provider: "plaid",
          providerAccountId: account.providerAccountId,
          institutionName: account.institutionName,
          type: account.type,
          subtype: account.subtype,
          officialName: account.officialName,
          currentBalance: account.currentBalance,
          availableBalance: account.availableBalance,
          isoCurrencyCode: account.isoCurrencyCode,
        }),
      ),
    );

    // ING-13: request the first sync immediately rather than leaving a
    // newly linked account to wait on a webhook (disabled locally) or the
    // next scheduled poll. requestProviderSync() is the same dedup'd
    // entry point the webhook and the poll both use (queues.ts's own doc
    // comment already anticipated "a manual re-sync from the UI" as a
    // third caller), so this can never double up with either of them.
    // Fire-and-forget on purpose: the sync can take multiple pages and
    // this response shouldn't block on it, and a failure to *enqueue*
    // here would be surprising (Redis down) -- log it, don't fail
    // account linking over it, since the connection/accounts are already
    // safely persisted above.
    try {
      await requestProviderSync(connection._id.toString());
    } catch (err) {
      req.log.error(
        { err, connectionId: connection._id.toString() },
        "[plaid] failed to queue initial sync",
      );
    }

    return reply.code(201).send({
      connectionId: connection._id.toString(),
      institutionName: connection.institutionName,
      accounts: accounts.map((account) => ({
        id: account._id.toString(),
        providerAccountId: account.providerAccountId,
        type: account.type,
        subtype: account.subtype,
        currentBalance: account.currentBalance,
      })),
    });
  });
}
