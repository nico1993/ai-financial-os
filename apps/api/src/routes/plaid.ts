// routes/plaid.ts — Plaid Link flow (ING-3): link-token creation and
// public-token exchange. Every route here requires auth (AUTH-4) -- the
// resolved session userId is what the Connection/Account records get
// written against, and it's the same value passed to createLinkToken so
// Plaid's Link session and the eventual Connection line up.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AccountRepository, ConnectionRepository } from "@financial-os/db";
import { requireAuth } from "../auth/requireAuth.js";
import { getFinancialProvider } from "../provider.js";

const exchangeSchema = z.object({
  publicToken: z.string().min(1),
});

const connectionRepo = new ConnectionRepository();
const accountRepo = new AccountRepository();

export async function registerPlaidRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/plaid/link-token", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const { linkToken } = await getFinancialProvider().createLinkToken({ userId });
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
