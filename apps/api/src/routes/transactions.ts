// routes/transactions.ts — WEB-8: the general ledger read side (every
// linked account's transactions, paginated). Also the `status` filter
// CAT-7's Tier 4 review queue reuses -- BACKLOG.md's own rescoping named
// `GET /api/transactions?status=needs_review` as the mechanism, so this
// route and TransactionRepository.findPageForUser() were both written to
// serve that call from day one rather than needing a near-duplicate
// later. CAT-7's own addition is the PATCH route at the bottom: manual
// category correction + its CAT-6 write-back into MerchantRules.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AccountRepository,
  MerchantRuleRepository,
  TransactionRepository,
  type TransactionCategory,
} from "@financial-os/db";
import { requireAuth } from "../auth/requireAuth.js";
import { buildTransactionList } from "../transactions/list.js";

const transactionRepo = new TransactionRepository();
const accountRepo = new AccountRepository();
const merchantRuleRepo = new MerchantRuleRepository();

const correctCategorySchema = z.object({
  category: z.string().trim().min(1),
});

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

// Query params arrive as strings over HTTP -- z.coerce handles the
// page/pageSize -> number conversion (and rejects anything that doesn't
// parse as one) rather than each call site doing Number(req.query.page)
// by hand.
const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(["confirmed", "needs_review"]).optional(),
});

export async function registerTransactionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/transactions", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = pageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid query" });
    }
    const userId = req.session.userId as string;
    const { page, pageSize, status } = parsed.data;

    // Accounts are looked up wholesale (findByUserId(), not per-transaction)
    // -- same reasoning as routes/accounts.ts: a user has a handful of
    // accounts, never thousands, and buildTransactionList() only needs to
    // join, not query.
    const [{ items, hasMore }, accounts] = await Promise.all([
      transactionRepo.findPageForUser(userId, { page, pageSize, status }),
      accountRepo.findByUserId(userId),
    ]);

    return reply.send({
      items: buildTransactionList(items, accounts),
      page,
      pageSize,
      hasMore,
    });
  });

  // CAT-7: manual Tier 4 correction. A human choosing a category is, by
  // definition, a confirmed decision -- there's no "needs_review" outcome
  // for a manual correction the way there is for Tier 3's confidence
  // threshold, so this always writes tier: 4, status: "confirmed".
  app.patch("/api/transactions/:id/category", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const params = z.object({ id: z.string().min(1) }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid transaction id" });
    }
    const body = correctCategorySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid input" });
    }

    const category: TransactionCategory = {
      tier: 4,
      value: body.data.category,
      status: "confirmed",
    };
    const updated = await transactionRepo.updateCategoryForUser(userId, params.data.id, category);
    if (!updated) {
      return reply.code(404).send({ error: "transaction not found" });
    }

    // CAT-6's write-back loop (ADR-0027), same mechanism
    // categorizeLlm.ts uses for Tier 3's confirmed results -- called
    // directly against MerchantRuleRepository rather than importing
    // apps/worker/src/categorize/writeBack.ts's buildMerchantRuleWriteBack():
    // apps/api has no dependency on apps/worker (only @financial-os/db,
    // providers, shared, config -- confirmed via package.json), and that
    // function's own doc comment already sanctions this as the
    // alternative ("or skip straight to MerchantRuleRepository"). Its
    // status !== "confirmed" guard is moot here anyway -- this route
    // always writes "confirmed" -- so nothing is lost by not calling it.
    await merchantRuleRepo.upsertExact({
      userId,
      pattern: updated.merchantNameNormalized,
      category: category.value,
      source: "manual",
    });

    return reply.send({
      id: updated._id.toString(),
      category: { value: category.value, status: category.status },
    });
  });
}
