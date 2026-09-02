// routes/transactions.ts — WEB-8: the general ledger read side (every
// linked account's transactions, paginated). Also the `status` filter
// CAT-7's Tier 4 review queue reuses -- BACKLOG.md's own rescoping named
// `GET /api/transactions?status=needs_review` as the mechanism, so this
// route and TransactionRepository.findPageForUser() were both written to
// serve that call from day one rather than needing a near-duplicate
// later. CAT-7's own addition is the PATCH route at the bottom: manual
// category correction + its CAT-6 write-back into MerchantRules.
//
// WEB-10 adds dateFrom/dateTo/category filters to the GET route (below).
// CAT-13 broadens the PATCH route: it was `PATCH /api/transactions/:id/category`
// (category-only) through CAT-7; CAT-13's own ticket text calls for
// reusing "the same endpoint CAT-12's edit popup calls" for its
// merchant-name-override field rather than adding a second route, so
// this is now `PATCH /api/transactions/:id`, taking `category` and/or
// `merchantNameOverride` (at least one required) -- CAT-12, whenever it
// lands, is expected to add its third field (icon selection lives on
// Category, not Transaction, so that one's actually CAT-11's route) onto
// this same endpoint rather than a fourth.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AccountRepository,
  MerchantRuleRepository,
  TransactionRepository,
  type TransactionCategory,
  type TransactionDocument,
} from "@financial-os/db";
import { requireAuth } from "../auth/requireAuth.js";
import { buildTransactionList } from "../transactions/list.js";

const transactionRepo = new TransactionRepository();
const accountRepo = new AccountRepository();
const merchantRuleRepo = new MerchantRuleRepository();

const patchTransactionSchema = z
  .object({
    category: z.string().trim().min(1).optional(),
    // No .min(1) -- an empty string is meaningful (clears the override
    // back to merchantName ?? merchantNameNormalized), the same
    // empty-clears convention routes/accounts.ts's rename endpoint uses.
    merchantNameOverride: z.string().max(200).optional(),
  })
  .refine((body) => body.category !== undefined || body.merchantNameOverride !== undefined, {
    message: "at least one of category or merchantNameOverride is required",
  });

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

const isValidDateString = (value: string): boolean => !Number.isNaN(new Date(value).getTime());
const dateStringSchema = z.string().refine(isValidDateString, { message: "must be a valid date" });

// Query params arrive as strings over HTTP -- z.coerce handles the
// page/pageSize -> number conversion (and rejects anything that doesn't
// parse as one) rather than each call site doing Number(req.query.page)
// by hand.
//
// WEB-10: dateFrom/dateTo/category, all optional and independent of one
// another (unlike routes/analytics.ts's rangeQuerySchema, start/end
// aren't required here as a pair -- this is a filter on an
// already-useful unfiltered ledger, not a dashboard aggregate that's
// meaningless without a window).
const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(["confirmed", "needs_review"]).optional(),
  dateFrom: dateStringSchema.optional(),
  dateTo: dateStringSchema.optional(),
  category: z.string().trim().min(1).optional(),
});

export async function registerTransactionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/transactions", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = pageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid query" });
    }
    const userId = req.session.userId as string;
    const { page, pageSize, status, dateFrom, dateTo, category } = parsed.data;

    // Accounts are looked up wholesale (findByUserId(), not per-transaction)
    // -- same reasoning as routes/accounts.ts: a user has a handful of
    // accounts, never thousands, and buildTransactionList() only needs to
    // join, not query.
    const [{ items, hasMore }, accounts] = await Promise.all([
      transactionRepo.findPageForUser(userId, {
        page,
        pageSize,
        status,
        category,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
      }),
      accountRepo.findByUserId(userId),
    ]);

    return reply.send({
      items: buildTransactionList(items, accounts),
      page,
      pageSize,
      hasMore,
    });
  });

  // CAT-7: manual Tier 4 correction (category), broadened by CAT-13 to
  // also accept a merchantNameOverride in the same request/route rather
  // than a second PATCH endpoint. A human choosing a category is, by
  // definition, a confirmed decision -- there's no "needs_review" outcome
  // for a manual correction the way there is for Tier 3's confidence
  // threshold, so a category change always writes tier: 4, status:
  // "confirmed". Each field updates independently -- a caller sending
  // only `merchantNameOverride` never touches category.tier/status.value,
  // and vice versa.
  app.patch("/api/transactions/:id", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const params = z.object({ id: z.string().min(1) }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid transaction id" });
    }
    const body = patchTransactionSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid input" });
    }

    let updated: TransactionDocument | null = null;

    if (body.data.category !== undefined) {
      const category: TransactionCategory = {
        tier: 4,
        value: body.data.category,
        status: "confirmed",
      };
      updated = await transactionRepo.updateCategoryForUser(userId, params.data.id, category);
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
    }

    if (body.data.merchantNameOverride !== undefined) {
      const trimmed = body.data.merchantNameOverride.trim();
      updated = await transactionRepo.updateMerchantNameOverrideForUser(
        userId,
        params.data.id,
        trimmed.length > 0 ? trimmed : null,
      );
      if (!updated) {
        return reply.code(404).send({ error: "transaction not found" });
      }
    }

    if (!updated) {
      // Unreachable given patchTransactionSchema's refine (at least one
      // of category/merchantNameOverride is always present, and both
      // branches above already return early on a null result) -- this
      // keeps the return below honestly typed rather than a non-null
      // assertion on `updated`.
      return reply.code(400).send({ error: "no fields to update" });
    }

    return reply.send({
      id: updated._id.toString(),
      category: { value: updated.category.value, status: updated.category.status },
      merchantName:
        updated.merchantNameOverride ?? updated.merchantName ?? updated.merchantNameNormalized,
    });
  });
}
