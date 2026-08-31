// routes/analytics.ts — ANLY-3/ANLY-4/ANLY-5/ANLY-6: the dashboard's read
// endpoints (ARCHITECTURE.md §4.2, ADR-0035). Every route here is
// requireAuth-gated (AUTH-4) -- there is no public data in this app.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { RollupRepository, SubscriptionRepository, TransactionRepository } from "@financial-os/db";
import { requireAuth } from "../auth/requireAuth.js";
import { fillNetWorthSeries, type NetWorthSourceSnapshot } from "../analytics/netWorth.js";
import { fillMonthlyCashFlowSeries } from "../analytics/cashFlow.js";

const rollups = new RollupRepository();
const transactions = new TransactionRepository();
const subscriptions = new SubscriptionRepository();

const isValidDateString = (value: string): boolean => !Number.isNaN(new Date(value).getTime());

const dateStringSchema = z.string().refine(isValidDateString, { message: "must be a valid date" });

/** `start`/`end` are required on every route below -- ARCHITECTURE.md
 * never specifies a default window, and guessing one (e.g. "last 12
 * months") would be a product decision this route has no business making
 * silently (AGENTS.md). `compareStart`/`compareEnd` (ANLY-6) must arrive
 * as a pair or not at all. */
const rangeQuerySchema = z
  .object({
    start: dateStringSchema,
    end: dateStringSchema,
    compareStart: dateStringSchema.optional(),
    compareEnd: dateStringSchema.optional(),
  })
  .refine((q) => Boolean(q.compareStart) === Boolean(q.compareEnd), {
    message: "compareStart and compareEnd must be provided together",
  });

interface ParsedRangeQuery {
  range: { start: Date; end: Date };
  compareRange?: { start: Date; end: Date };
}

/** Shared query parsing for every route below. Returns `null` (after
 * already sending the 400) on invalid input, so callers can `if (!parsed)
 * return;` and stop. */
function parseRangeQuery(
  req: FastifyRequest,
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
): ParsedRangeQuery | null {
  const parsed = rangeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid query" });
    return null;
  }
  const { start, end, compareStart, compareEnd } = parsed.data;
  return {
    range: { start: new Date(start), end: new Date(end) },
    compareRange:
      compareStart && compareEnd
        ? { start: new Date(compareStart), end: new Date(compareEnd) }
        : undefined,
  };
}

export async function registerAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  // ANLY-3: Net Worth.
  app.get("/api/analytics/net-worth", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = parseRangeQuery(req, reply);
    if (!parsed) return;
    const userId = req.session.userId as string;
    const { range } = parsed;

    // getNetWorthSeries() only covers `range` itself; the carry-forward
    // starting point (ADR-0035) can predate it entirely, so the latest
    // snapshot at or before range.start is fetched separately and merged
    // in -- fillNetWorthSeries() scans the whole set for the right seed
    // regardless of which array element it came from.
    const [inRange, latestBefore] = await Promise.all([
      rollups.getNetWorthSeries(userId, range),
      rollups.getLatestNetWorthSnapshotBefore(userId, range.start),
    ]);

    const toSourceSnapshot = (doc: (typeof inRange)[number]): NetWorthSourceSnapshot => ({
      date: doc.date,
      netWorth: doc.netWorth,
      assets: doc.assets,
      liabilities: doc.liabilities,
      accounts: doc.accounts.map((a) => ({
        accountId: a.accountId.toString(),
        balance: a.balance,
      })),
    });

    const snapshots = latestBefore
      ? [toSourceSnapshot(latestBefore), ...inRange.map(toSourceSnapshot)]
      : inRange.map(toSourceSnapshot);

    return reply.send(fillNetWorthSeries(snapshots, range));
  });

  // ANLY-4/ANLY-6: Monthly Cash Flow, with optional comparison range.
  app.get("/api/analytics/cash-flow", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = parseRangeQuery(req, reply);
    if (!parsed) return;
    const userId = req.session.userId as string;
    const { range, compareRange } = parsed;

    // Two cheap indexed reads against the small, pre-aggregated
    // MonthlyRollup collection, not a $facet (ADR-0035): $facet earns its
    // keep avoiding a second full scan of the large, unbounded raw
    // Transactions collection (getCategoryDistributionComparison() below),
    // which doesn't apply here.
    const [current, compare] = await Promise.all([
      rollups.getMonthlyRollup(userId, range),
      compareRange ? rollups.getMonthlyRollup(userId, compareRange) : Promise.resolve(null),
    ]);

    return reply.send({
      current: fillMonthlyCashFlowSeries(current, range),
      compare: compare && compareRange ? fillMonthlyCashFlowSeries(compare, compareRange) : null,
    });
  });

  // ANLY-5/ANLY-6: Categorical Spending Distribution, with optional
  // comparison range.
  app.get("/api/analytics/spending-categories", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = parseRangeQuery(req, reply);
    if (!parsed) return;
    const userId = req.session.userId as string;
    const { range, compareRange } = parsed;

    if (compareRange) {
      const result = await transactions.getCategoryDistributionComparison(
        userId,
        range,
        compareRange,
      );
      return reply.send({ current: result.current, compare: result.compare });
    }

    const current = await transactions.getCategoryDistribution(userId, range);
    return reply.send({ current, compare: null });
  });

  // Subscriptions -- not its own ANLY ticket, but ANLY-9's Subscriptions
  // page needs a real endpoint to call (useRecurringQuery), and
  // ANLY-7 already built the read side (SubscriptionRepository); this is
  // the thin route connecting them. No range params: unlike the other
  // three, "active subscriptions right now" isn't a windowed query.
  app.get("/api/analytics/subscriptions", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session.userId as string;
    const active = await subscriptions.findActiveByUser(userId);
    return reply.send(
      active.map((s) => ({
        id: s._id.toString(),
        merchantName: s.merchantName,
        amount: s.amount,
        intervalDays: s.intervalDays,
        frequency: s.frequency,
        lastTransactionDate: s.lastTransactionDate,
        nextExpectedDate: s.nextExpectedDate,
      })),
    );
  });
}
