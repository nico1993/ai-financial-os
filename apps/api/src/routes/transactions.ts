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
//
// XFER-7 adds two more routes at the bottom: GET .../transfer-candidates
// (ranks this user's own unmatched pool as possible counterparts for one
// needs_review, transfer-signal transaction) and POST .../link-transfer
// (applies the chosen pair via TransactionRepository.applyTransferMatch()).
// Both reuse @financial-os/shared's suggestTransferCandidates() --
// relocated there from apps/worker specifically so this file could reach
// it (AGENTS.md's dependency direction: apps/api cannot import
// apps/worker).
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AccountRepository,
  MerchantRuleRepository,
  TransactionRepository,
  type TransactionCategory,
  type TransactionDocument,
} from "@financial-os/db";
import { suggestTransferCandidates, type TransferCandidateTransaction } from "@financial-os/shared";
import { requireAuth } from "../auth/requireAuth.js";
import { env } from "../env.js";
import { requestRollup } from "../queues.js";
import { buildTransactionList } from "../transactions/list.js";

const transactionRepo = new TransactionRepository();
const accountRepo = new AccountRepository();
const merchantRuleRepo = new MerchantRuleRepository();

// A short ranked list to pick from (suggestTransferCandidates()'s own doc
// comment) -- capped defensively, not because real usage is ever expected
// to approach this: the route's tight date/amount tolerances already rule
// out almost everything in a real history, but the pool itself is an
// unbounded full-history scan (findUnmatchedTransferCandidates()'s own
// doc comment), so a pathological history could in principle produce more
// matches than any picker UI should ever show at once.
const MAX_TRANSFER_CANDIDATES = 10;

const linkTransferSchema = z.object({
  counterpartId: z.string().min(1),
});

// apps/api's own tiny copy of apps/worker/src/sync/normalize.ts's
// utcDayStart()/utcMonthStart() -- apps/api cannot import from apps/worker
// (see this file's header comment above), and apps/api/src/analytics/
// cashFlow.ts and netWorth.ts already each keep an identical private
// one-liner rather than promoting this to a shared module, so this
// follows that same established precedent rather than inventing a new
// one.
function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** De-dupes `dates` down to the distinct UTC day/month buckets they fall
 * in -- the same Map-keyed-by-ISO-string dedup
 * apps/worker/src/queues/transferMatching.ts's own recordBucket() uses,
 * so linking two same-day (or same-month) transactions doesn't ask for
 * the same bucket twice. */
function collectBuckets(dates: readonly Date[]): { days: Date[]; months: Date[] } {
  const days = new Map<string, Date>();
  const months = new Map<string, Date>();
  for (const date of dates) {
    const day = utcDayStart(date);
    const month = utcMonthStart(date);
    days.set(day.toISOString(), day);
    months.set(month.toISOString(), month);
  }
  return { days: [...days.values()], months: [...months.values()] };
}

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

  // XFER-7: for one needs_review, transfer-signal-tagged transaction,
  // ranks every still-available candidate from this user's own unmatched
  // pool as a possible counterpart -- the manual half of the same
  // opposite-sign/close-amount/nearby-date heuristic
  // apps/worker/src/queues/transferMatching.ts's automated pass already
  // runs, via the same @financial-os/shared function (moved there by
  // this story specifically so the two don't fork). The pool itself
  // (TransactionRepository.findUnmatchedTransferCandidates(userId), built
  // for XFER-2) already does double duty here: finding `:id` inside it is
  // both the ownership check (a wrong-user, or an already-matched/
  // removed/pending id, simply won't be in this user's pool) and the
  // candidate source, so this needs no separate lookup query.
  app.get(
    "/api/transactions/:id/transfer-candidates",
    { preHandler: requireAuth },
    async (req, reply) => {
      const userId = req.session.userId as string;
      const params = z.object({ id: z.string().min(1) }).safeParse(req.params);
      if (!params.success) {
        return reply.code(400).send({ error: "invalid transaction id" });
      }

      const pool = await transactionRepo.findUnmatchedTransferCandidates(userId);
      const anchorDoc = pool.find((tx) => tx._id.toString() === params.data.id);
      if (!anchorDoc) {
        return reply.code(404).send({ error: "transaction not found" });
      }

      const toCandidate = (tx: TransactionDocument): TransferCandidateTransaction => ({
        id: tx._id.toString(),
        accountId: tx.accountId.toString(),
        amount: tx.amount,
        date: tx.date,
        providerCategory: tx.providerCategory,
      });

      const ranked = suggestTransferCandidates(toCandidate(anchorDoc), pool.map(toCandidate), {
        dateToleranceDays: env.XFER_MATCH_DATE_TOLERANCE_DAYS,
        amountToleranceCents: env.XFER_MATCH_AMOUNT_TOLERANCE_CENTS,
      });

      const byId = new Map(pool.map((tx) => [tx._id.toString(), tx]));
      const rankedDocs = ranked
        .slice(0, MAX_TRANSFER_CANDIDATES)
        .map((c) => byId.get(c.id))
        .filter((tx): tx is TransactionDocument => tx !== undefined);

      const accounts = await accountRepo.findByUserId(userId);
      return reply.send({ items: buildTransactionList(rankedDocs, accounts) });
    },
  );

  // XFER-7: links `:id` (the transaction being reviewed) to
  // `counterpartId` (one of the suggestions the route above returned, or
  // any other id the client asserts is the other side --
  // applyTransferMatch()'s own ownership count-check is what actually
  // enforces both really belong to this user, same as the GET route
  // trusts findUnmatchedTransferCandidates()'s pool rather than
  // re-deriving that check a second way).
  app.post(
    "/api/transactions/:id/link-transfer",
    { preHandler: requireAuth },
    async (req, reply) => {
      const userId = req.session.userId as string;
      const params = z.object({ id: z.string().min(1) }).safeParse(req.params);
      if (!params.success) {
        return reply.code(400).send({ error: "invalid transaction id" });
      }
      const body = linkTransferSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "invalid input" });
      }
      if (body.data.counterpartId === params.data.id) {
        return reply.code(400).send({ error: "cannot link a transaction to itself" });
      }

      const transferGroupId = randomUUID();
      const applied = await transactionRepo.applyTransferMatch(
        userId,
        [params.data.id, body.data.counterpartId],
        transferGroupId,
      );
      if (!applied) {
        // Covers both "not mine" and "no such transaction" the same 404 way
        // every other ownership-scoped route in this file does --
        // applyTransferMatch()'s own doc comment explains why this has to
        // be an all-or-nothing refusal rather than a partial link.
        return reply.code(404).send({ error: "transaction not found" });
      }

      // The link itself just succeeded and is durable -- everything past
      // this point resolves the review-queue side effect and the net-worth/
      // cash-flow staleness side effect, neither of which should turn an
      // already-successful link into a reported failure if it stumbles.
      const [updatedAnchor, counterpart] = await Promise.all([
        // A human explicitly confirming "this is a transfer, link it there"
        // is exactly as much a confirmed decision as picking a category
        // from CAT-7's dropdown -- applyTransferMatch() itself never
        // touches category (XFER-3's automated path deliberately leaves an
        // already-processed transaction's Tier 1-3 category alone), so
        // without this the transaction would stay stuck in the
        // needs_review queue forever despite the link having worked.
        // "Transfer" is the one category value that actually describes
        // what just happened, not whatever guess Tier 1-3 had previously
        // landed on (CAT-18's seeded default category -- a free-text value
        // on Transaction.category, not a foreign key, so this write can't
        // fail structurally even for a user who somehow never got that
        // seed row created, ReviewCategoryControl.tsx's own fallback for
        // that same edge case).
        transactionRepo.updateCategoryForUser(userId, params.data.id, {
          tier: 4,
          value: "Transfer",
          status: "confirmed",
        }),
        // Only for its date, to recompute the right rollup buckets below --
        // deliberately the plain findById() (unscoped), not a second
        // ownership check: applyTransferMatch() above already proved this
        // id belongs to userId moments ago.
        transactionRepo.findById(body.data.counterpartId),
      ]);

      if (!updatedAnchor) {
        // Extremely unlikely: applyTransferMatch() above just confirmed
        // this id exists and belongs to userId; something would have to
        // remove it in the few milliseconds since. Same 404-not-500
        // treatment as everywhere else in this file.
        return reply.code(404).send({ error: "transaction not found" });
      }

      // ADR-0008: a write that changes excludeFromCashFlow stales a
      // MonthlyRollup already computed for that bucket -- the same signal
      // apps/worker/src/queues/transferMatching.ts's automated pass emits
      // for exactly this reason after its own applyTransferMatch() calls.
      // This route is the only apps/api write that ever sets
      // excludeFromCashFlow, so it's the only one that needs to ask for it.
      const { days, months } = collectBuckets(
        counterpart ? [updatedAnchor.date, counterpart.date] : [updatedAnchor.date],
      );
      try {
        await requestRollup(userId, days, months);
      } catch (err) {
        // Best-effort, per the comment above the Promise.all: the link is
        // already durable. A failed enqueue here just means these buckets
        // stay stale until the next sync recomputes them anyway, not
        // something worth failing an otherwise-successful request over.
        req.log.error({ err }, "[transfer-link] failed to enqueue rollup recompute");
      }

      return reply.send({
        id: updatedAnchor._id.toString(),
        transferGroupId,
        category: { value: updatedAnchor.category.value, status: updatedAnchor.category.status },
      });
    },
  );
}
