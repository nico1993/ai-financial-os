import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { setupTestDb } from "../test/mongo-memory.js";
import {
  TransactionRepository,
  type DateRange,
  type UpsertTransactionInput,
} from "./TransactionRepository.js";

const db = setupTestDb();
const repo = new TransactionRepository();

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

function baseInput(overrides: Partial<UpsertTransactionInput> = {}): UpsertTransactionInput {
  return {
    userId: "user-1",
    accountId: new mongoose.Types.ObjectId(),
    providerTransactionId: "txn-1",
    date: new Date("2026-01-15T00:00:00.000Z"),
    amount: -4200,
    isoCurrencyCode: "USD",
    merchantNameNormalized: "trader joes",
    description: "TRADER JOE'S #123",
    category: { tier: 1, value: "Groceries", status: "confirmed" },
    ...overrides,
  };
}

describe("TransactionRepository", () => {
  it("upsertFromSync creates a new transaction", async () => {
    const created = await repo.upsertFromSync(baseInput());
    expect(created.merchantNameNormalized).toBe("trader joes");
    expect(created.excludeFromCashFlow).toBe(false);
    expect(created.isRemoved).toBe(false);
  });

  it("upsertFromSync is idempotent by providerTransactionId — a resync updates, not duplicates", async () => {
    await repo.upsertFromSync(baseInput());
    await repo.upsertFromSync(baseInput({ amount: -4500, description: "TRADER JOE'S #123 ADJ" }));

    const all = await repo.findByUserAndDateRange("user-1", {
      start: new Date("2026-01-01"),
      end: new Date("2026-01-31"),
    });
    expect(all).toHaveLength(1);
    expect(all[0]?.amount).toBe(-4500);
    expect(all[0]?.description).toBe("TRADER JOE'S #123 ADJ");
  });

  it("upsertFromSync does NOT overwrite an existing category on a provider 'modified' event", async () => {
    // The sync job passes a placeholder category on every upsert. Without
    // $setOnInsert, a Plaid amount correction would silently undo Tier 1/2/3
    // categorization — or a manual Tier 4 correction the user just made.
    await repo.upsertFromSync(
      baseInput({ category: { tier: 1, value: "Groceries", status: "confirmed" } }),
    );
    await repo.upsertFromSync(
      baseInput({
        amount: -4500,
        category: { tier: 4, value: "Uncategorized", status: "needs_review" },
      }),
    );

    const found = await repo.findByProviderTransactionId("txn-1");
    expect(found?.amount).toBe(-4500);
    expect(found?.category.value).toBe("Groceries");
    expect(found?.category.status).toBe("confirmed");
  });

  it("updateCategory is the supported way to re-categorize", async () => {
    const created = await repo.upsertFromSync(baseInput());
    await repo.updateCategory(created._id.toString(), {
      tier: 3,
      value: "Dining",
      confidence: 0.8,
      status: "needs_review",
    });

    const found = await repo.findByProviderTransactionId("txn-1");
    expect(found?.category.value).toBe("Dining");
  });

  it("findByProviderTransactionId returns the transaction, or null when unknown", async () => {
    await repo.upsertFromSync(baseInput());

    expect((await repo.findByProviderTransactionId("txn-1"))?.amount).toBe(-4200);
    expect(await repo.findByProviderTransactionId("nope")).toBeNull();
  });

  it("findByUserAndDateRange filters by range and excludes removed by default", async () => {
    await repo.upsertFromSync(
      baseInput({ providerTransactionId: "in-range", date: new Date("2026-01-15") }),
    );
    await repo.upsertFromSync(
      baseInput({ providerTransactionId: "out-of-range", date: new Date("2026-03-01") }),
    );
    await repo.upsertFromSync(
      baseInput({
        providerTransactionId: "removed",
        date: new Date("2026-01-20"),
        isRemoved: true,
      }),
    );

    const results = await repo.findByUserAndDateRange("user-1", {
      start: new Date("2026-01-01"),
      end: new Date("2026-01-31"),
    });

    expect(results.map((t) => t.providerTransactionId)).toEqual(["in-range"]);
  });

  it("findNeedsReview returns only needs_review transactions", async () => {
    await repo.upsertFromSync(
      baseInput({
        providerTransactionId: "confirmed",
        category: { tier: 1, value: "Groceries", status: "confirmed" },
      }),
    );
    await repo.upsertFromSync(
      baseInput({
        providerTransactionId: "review",
        category: { tier: 3, value: "Uncertain", confidence: 0.4, status: "needs_review" },
      }),
    );

    const results = await repo.findNeedsReview("user-1");
    expect(results.map((t) => t.providerTransactionId)).toEqual(["review"]);
  });

  it("markRemoved soft-deletes without dropping the record", async () => {
    await repo.upsertFromSync(baseInput());
    await repo.markRemoved("txn-1");

    const found = await repo.findByUserAndDateRange(
      "user-1",
      { start: new Date("2026-01-01"), end: new Date("2026-01-31") },
      { includeRemoved: true },
    );
    expect(found[0]?.isRemoved).toBe(true);
  });

  it("findCorrectedMerchants returns only tier-4 confirmed transactions", async () => {
    await repo.upsertFromSync(
      baseInput({
        providerTransactionId: "manual-correction",
        merchantNameNormalized: "trader joes",
        category: { tier: 4, value: "Groceries", status: "confirmed" },
      }),
    );
    await repo.upsertFromSync(
      baseInput({
        providerTransactionId: "auto-tier1",
        merchantNameNormalized: "starbucks",
        category: { tier: 1, value: "Dining", status: "confirmed" },
      }),
    );
    await repo.upsertFromSync(
      baseInput({
        providerTransactionId: "needs-review",
        merchantNameNormalized: "unknown biz",
        category: { tier: 4, value: "Uncategorized", status: "needs_review" },
      }),
    );

    const results = await repo.findCorrectedMerchants("user-1");
    expect(results).toEqual([{ normalizedMerchant: "trader joes", category: "Groceries" }]);
  });

  it("findCorrectedMerchants excludes soft-removed transactions", async () => {
    await repo.upsertFromSync(
      baseInput({
        providerTransactionId: "removed-correction",
        merchantNameNormalized: "trader joes",
        category: { tier: 4, value: "Groceries", status: "confirmed" },
        isRemoved: true,
      }),
    );

    expect(await repo.findCorrectedMerchants("user-1")).toEqual([]);
  });

  it("applyTransferMatch links both sides and excludes them from cash flow", async () => {
    const a = await repo.upsertFromSync(baseInput({ providerTransactionId: "out", amount: -5000 }));
    const b = await repo.upsertFromSync(baseInput({ providerTransactionId: "in", amount: 5000 }));

    const applied = await repo.applyTransferMatch(
      "user-1",
      [a._id.toString(), b._id.toString()],
      "group-1",
    );
    expect(applied).toBe(true);

    const results = await repo.findByUserAndDateRange("user-1", {
      start: new Date("2026-01-01"),
      end: new Date("2026-01-31"),
    });
    for (const txn of results) {
      expect(txn.transferGroupId).toBe("group-1");
      expect(txn.excludeFromCashFlow).toBe(true);
    }
  });

  // XFER-7: applyTransferMatch's own ownership check -- the whole reason
  // this method gained a userId parameter (BACKLOG.md's own note:
  // "XFER-7 must validate the request by the user's session id comparing
  // whether the tx id belongs to that customer").
  it("applyTransferMatch refuses a pair where only one id belongs to the caller, and touches neither", async () => {
    const mine = await repo.upsertFromSync(
      baseInput({ userId: "user-1", providerTransactionId: "mine", amount: -5000 }),
    );
    const theirs = await repo.upsertFromSync(
      baseInput({ userId: "user-2", providerTransactionId: "theirs", amount: 5000 }),
    );

    const applied = await repo.applyTransferMatch(
      "user-1",
      [mine._id.toString(), theirs._id.toString()],
      "group-1",
    );
    expect(applied).toBe(false);

    // Neither side got partially linked -- the exact failure mode this
    // count-before-write check exists to prevent.
    const mineAfter = await repo.findById(mine._id.toString());
    const theirsAfter = await repo.findById(theirs._id.toString());
    expect(mineAfter?.transferGroupId).toBeUndefined();
    expect(theirsAfter?.transferGroupId).toBeUndefined();
  });

  it("applyTransferMatch refuses a wholly nonexistent id and touches nothing", async () => {
    const mine = await repo.upsertFromSync(
      baseInput({ userId: "user-1", providerTransactionId: "mine", amount: -5000 }),
    );

    const applied = await repo.applyTransferMatch(
      "user-1",
      [mine._id.toString(), new mongoose.Types.ObjectId().toString()],
      "group-1",
    );
    expect(applied).toBe(false);

    const mineAfter = await repo.findById(mine._id.toString());
    expect(mineAfter?.transferGroupId).toBeUndefined();
  });

  it("upsertFromSync stores providerCategory and refreshes it on resync -- provider-owned, not app-owned like category", async () => {
    const created = await repo.upsertFromSync(
      baseInput({ providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER" }),
    );
    expect(created.providerCategory).toBe("TRANSFER_OUT_ACCOUNT_TRANSFER");

    const updated = await repo.upsertFromSync(
      baseInput({ providerCategory: "TRANSFER_OUT_SAVINGS" }),
    );
    expect(updated.providerCategory).toBe("TRANSFER_OUT_SAVINGS");
  });

  it("findUnmatchedTransferCandidates returns non-removed, settled, not-yet-grouped transactions", async () => {
    await repo.upsertFromSync(baseInput({ providerTransactionId: "eligible" }));
    await repo.upsertFromSync(baseInput({ providerTransactionId: "removed-one", isRemoved: true }));
    await repo.upsertFromSync(baseInput({ providerTransactionId: "pending-one", pending: true }));
    const grouped = await repo.upsertFromSync(baseInput({ providerTransactionId: "grouped-one" }));
    await repo.applyTransferMatch("user-1", [grouped._id.toString()], "group-existing");

    const results = await repo.findUnmatchedTransferCandidates("user-1");
    expect(results.map((tx) => tx.providerTransactionId)).toEqual(["eligible"]);
  });

  it("findUnmatchedTransferCandidates is scoped to the requesting user", async () => {
    await repo.upsertFromSync(baseInput({ providerTransactionId: "mine", userId: "user-1" }));
    await repo.upsertFromSync(baseInput({ providerTransactionId: "theirs", userId: "user-2" }));

    const results = await repo.findUnmatchedTransferCandidates("user-1");
    expect(results.map((tx) => tx.providerTransactionId)).toEqual(["mine"]);
  });

  describe("findAccountDeltasAfter", () => {
    const accountA = new mongoose.Types.ObjectId();
    const accountB = new mongoose.Types.ObjectId();
    const AFTER = new Date("2026-01-15T00:00:00.000Z");

    it("only returns transactions dated strictly after the given date", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "before",
          accountId: accountA,
          date: new Date("2026-01-10"),
        }),
      );
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "on-day", accountId: accountA, date: AFTER }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "after",
          accountId: accountA,
          date: new Date("2026-01-20"),
          amount: 1234,
        }),
      );

      const deltas = await repo.findAccountDeltasAfter("user-1", AFTER);
      expect(deltas).toEqual([{ accountId: accountA.toString(), amount: 1234 }]);
    });

    it("groups nothing itself -- returns one row per transaction, across accounts", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "a1",
          accountId: accountA,
          date: new Date("2026-01-20"),
          amount: 100,
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "a2",
          accountId: accountA,
          date: new Date("2026-01-21"),
          amount: 200,
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "b1",
          accountId: accountB,
          date: new Date("2026-01-22"),
          amount: -50,
        }),
      );

      const deltas = await repo.findAccountDeltasAfter("user-1", AFTER);
      expect(deltas).toHaveLength(3);
      expect(
        deltas.filter((d) => d.accountId === accountA.toString()).map((d) => d.amount),
      ).toEqual([100, 200]);
      expect(
        deltas.filter((d) => d.accountId === accountB.toString()).map((d) => d.amount),
      ).toEqual([-50]);
    });

    it("excludes removed transactions", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "gone",
          accountId: accountA,
          date: new Date("2026-01-20"),
        }),
      );
      await repo.markRemoved("gone");

      const deltas = await repo.findAccountDeltasAfter("user-1", AFTER);
      expect(deltas).toEqual([]);
    });

    it("excludes pending transactions", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "still-pending",
          accountId: accountA,
          date: new Date("2026-01-20"),
          pending: true,
        }),
      );

      const deltas = await repo.findAccountDeltasAfter("user-1", AFTER);
      expect(deltas).toEqual([]);
    });

    it("is scoped to the requesting user", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "mine",
          accountId: accountA,
          date: new Date("2026-01-20"),
          userId: "user-1",
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "theirs",
          accountId: accountA,
          date: new Date("2026-01-20"),
          userId: "user-2",
        }),
      );

      const deltas = await repo.findAccountDeltasAfter("user-1", AFTER);
      expect(deltas).toHaveLength(1);
    });
  });

  describe("findForCashFlow", () => {
    const JAN: DateRange = {
      start: new Date("2026-01-01"),
      end: new Date("2026-01-31"),
    };

    it("returns amounts for transactions within the range", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "groceries",
          date: new Date("2026-01-10"),
          amount: 4200,
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "paycheck",
          date: new Date("2026-01-15"),
          amount: -200000,
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "next-month",
          date: new Date("2026-02-01"),
          amount: 999,
        }),
      );

      const rows = await repo.findForCashFlow("user-1", JAN);
      expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([-200000, 4200]);
    });

    it("excludes removed transactions", async () => {
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "gone", date: new Date("2026-01-10"), amount: 500 }),
      );
      await repo.markRemoved("gone");

      const rows = await repo.findForCashFlow("user-1", JAN);
      expect(rows).toEqual([]);
    });

    it("excludes transfer-matched transactions (excludeFromCashFlow: true)", async () => {
      const matched = await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "internal-transfer",
          date: new Date("2026-01-10"),
          amount: 5000,
        }),
      );
      await repo.applyTransferMatch("user-1", [matched._id.toString()], "group-1");

      const rows = await repo.findForCashFlow("user-1", JAN);
      expect(rows).toEqual([]);
    });

    it("includes pending transactions", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "pending-charge",
          date: new Date("2026-01-10"),
          amount: 750,
          pending: true,
        }),
      );

      const rows = await repo.findForCashFlow("user-1", JAN);
      expect(rows).toEqual([{ amount: 750 }]);
    });

    it("is scoped to the requesting user", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "mine",
          date: new Date("2026-01-10"),
          amount: 1,
          userId: "user-1",
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "theirs",
          date: new Date("2026-01-10"),
          amount: 2,
          userId: "user-2",
        }),
      );

      const rows = await repo.findForCashFlow("user-1", JAN);
      expect(rows).toEqual([{ amount: 1 }]);
    });
  });

  describe("getCategoryDistribution", () => {
    const JAN: DateRange = { start: new Date("2026-01-01"), end: new Date("2026-01-31") };

    it("groups by category.value and sums amounts, sorted descending", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "g1",
          date: new Date("2026-01-05"),
          amount: 4_000,
          category: { tier: 1, value: "Groceries", status: "confirmed" },
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "g2",
          date: new Date("2026-01-10"),
          amount: 3_000,
          category: { tier: 1, value: "Groceries", status: "confirmed" },
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "r1",
          date: new Date("2026-01-15"),
          amount: 150_000,
          category: { tier: 1, value: "Rent", status: "confirmed" },
        }),
      );

      const distribution = await repo.getCategoryDistribution("user-1", JAN);
      expect(distribution).toEqual([
        { category: "Rent", total: 150_000 },
        { category: "Groceries", total: 7_000 },
      ]);
    });

    it("excludes income (negative amounts) from a spending distribution", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "paycheck",
          date: new Date("2026-01-01"),
          amount: -200_000,
          category: { tier: 1, value: "Income", status: "confirmed" },
        }),
      );
      const distribution = await repo.getCategoryDistribution("user-1", JAN);
      expect(distribution).toEqual([]);
    });

    it("excludes transfer-matched transactions", async () => {
      const matched = await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "internal",
          date: new Date("2026-01-01"),
          amount: 5_000,
          category: { tier: 1, value: "Transfer", status: "confirmed" },
        }),
      );
      await repo.applyTransferMatch("user-1", [matched._id.toString()], "group-1");

      const distribution = await repo.getCategoryDistribution("user-1", JAN);
      expect(distribution).toEqual([]);
    });

    it("is scoped to the requesting user", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "mine",
          date: new Date("2026-01-05"),
          amount: 1_000,
          userId: "user-1",
          category: { tier: 1, value: "Groceries", status: "confirmed" },
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "theirs",
          date: new Date("2026-01-05"),
          amount: 1_000,
          userId: "user-2",
          category: { tier: 1, value: "Groceries", status: "confirmed" },
        }),
      );

      const distribution = await repo.getCategoryDistribution("user-1", JAN);
      expect(distribution).toEqual([{ category: "Groceries", total: 1_000 }]);
    });
  });

  describe("getIncomeCategoryDistribution", () => {
    const JAN: DateRange = { start: new Date("2026-01-01"), end: new Date("2026-01-31") };

    it("groups by category.value and sums income (negative amounts), returning positive totals, sorted descending", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "paycheck1",
          date: new Date("2026-01-05"),
          amount: -200_000,
          category: { tier: 1, value: "Income", status: "confirmed" },
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "paycheck2",
          date: new Date("2026-01-20"),
          amount: -200_000,
          category: { tier: 1, value: "Income", status: "confirmed" },
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "refund",
          date: new Date("2026-01-10"),
          amount: -5_000,
          category: { tier: 1, value: "Reimbursement", status: "confirmed" },
        }),
      );

      const distribution = await repo.getIncomeCategoryDistribution("user-1", JAN);
      expect(distribution).toEqual([
        { category: "Income", total: 400_000 },
        { category: "Reimbursement", total: 5_000 },
      ]);
    });

    it("excludes spending (positive amounts) from an income distribution", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "groceries",
          date: new Date("2026-01-05"),
          amount: 4_000,
          category: { tier: 1, value: "Groceries", status: "confirmed" },
        }),
      );
      const distribution = await repo.getIncomeCategoryDistribution("user-1", JAN);
      expect(distribution).toEqual([]);
    });

    it("excludes transfer-matched transactions", async () => {
      const matched = await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "internal-in",
          date: new Date("2026-01-01"),
          amount: -5_000,
          category: { tier: 1, value: "Transfer", status: "confirmed" },
        }),
      );
      await repo.applyTransferMatch("user-1", [matched._id.toString()], "group-1");

      const distribution = await repo.getIncomeCategoryDistribution("user-1", JAN);
      expect(distribution).toEqual([]);
    });

    it("is scoped to the requesting user", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "mine",
          date: new Date("2026-01-05"),
          amount: -1_000,
          userId: "user-1",
          category: { tier: 1, value: "Income", status: "confirmed" },
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "theirs",
          date: new Date("2026-01-05"),
          amount: -1_000,
          userId: "user-2",
          category: { tier: 1, value: "Income", status: "confirmed" },
        }),
      );

      const distribution = await repo.getIncomeCategoryDistribution("user-1", JAN);
      expect(distribution).toEqual([{ category: "Income", total: 1_000 }]);
    });
  });

  describe("getCategoryDistributionComparison", () => {
    const JAN: DateRange = { start: new Date("2026-01-01"), end: new Date("2026-01-31") };
    const FEB: DateRange = { start: new Date("2026-02-01"), end: new Date("2026-02-28") };

    it("splits current and compare ranges via a single $facet pass", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "jan-groceries",
          date: new Date("2026-01-05"),
          amount: 4_000,
          category: { tier: 1, value: "Groceries", status: "confirmed" },
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "feb-groceries",
          date: new Date("2026-02-05"),
          amount: 6_000,
          category: { tier: 1, value: "Groceries", status: "confirmed" },
        }),
      );

      const result = await repo.getCategoryDistributionComparison("user-1", FEB, JAN);
      expect(result.current).toEqual([{ category: "Groceries", total: 6_000 }]);
      expect(result.compare).toEqual([{ category: "Groceries", total: 4_000 }]);
    });

    it("returns empty facets when neither range has any matching transactions", async () => {
      const result = await repo.getCategoryDistributionComparison("user-1", FEB, JAN);
      expect(result).toEqual({ current: [], compare: [] });
    });
  });

  describe("findPageForUser", () => {
    it("filters to an inclusive dateFrom/dateTo window (WEB-10)", async () => {
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "before", date: new Date("2026-01-01") }),
      );
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "in-range-start", date: new Date("2026-01-10") }),
      );
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "in-range-end", date: new Date("2026-01-20") }),
      );
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "after", date: new Date("2026-02-01") }),
      );

      const { items } = await repo.findPageForUser("user-1", {
        page: 1,
        pageSize: 10,
        dateFrom: new Date("2026-01-10"),
        dateTo: new Date("2026-01-20"),
      });

      expect(items.map((i) => i.providerTransactionId).sort()).toEqual([
        "in-range-end",
        "in-range-start",
      ]);
    });

    it("supports an open-ended dateFrom with no dateTo", async () => {
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "before", date: new Date("2026-01-01") }),
      );
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "after", date: new Date("2026-02-01") }),
      );

      const { items } = await repo.findPageForUser("user-1", {
        page: 1,
        pageSize: 10,
        dateFrom: new Date("2026-01-15"),
      });

      expect(items.map((i) => i.providerTransactionId)).toEqual(["after"]);
    });

    it("filters to an exact category.value match (WEB-10)", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "groceries",
          category: { tier: 1, value: "Groceries", status: "confirmed" },
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "dining",
          category: { tier: 1, value: "Dining", status: "confirmed" },
        }),
      );

      const { items } = await repo.findPageForUser("user-1", {
        page: 1,
        pageSize: 10,
        category: "Groceries",
      });

      expect(items.map((i) => i.providerTransactionId)).toEqual(["groceries"]);
    });

    it("combines the category and date filters with the existing status filter", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "match",
          date: new Date("2026-01-10"),
          category: { tier: 1, value: "Groceries", status: "confirmed" },
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "wrong-status",
          date: new Date("2026-01-10"),
          category: { tier: 4, value: "Groceries", status: "needs_review" },
        }),
      );

      const { items } = await repo.findPageForUser("user-1", {
        page: 1,
        pageSize: 10,
        status: "confirmed",
        category: "Groceries",
        dateFrom: new Date("2026-01-01"),
        dateTo: new Date("2026-01-31"),
      });

      expect(items.map((i) => i.providerTransactionId)).toEqual(["match"]);
    });

    it("filters to an exact accountId match (WEB-13)", async () => {
      const accountA = new mongoose.Types.ObjectId();
      const accountB = new mongoose.Types.ObjectId();
      await repo.upsertFromSync(baseInput({ providerTransactionId: "a", accountId: accountA }));
      await repo.upsertFromSync(baseInput({ providerTransactionId: "b", accountId: accountB }));

      const { items } = await repo.findPageForUser("user-1", {
        page: 1,
        pageSize: 10,
        accountId: accountA.toString(),
      });

      expect(items.map((i) => i.providerTransactionId)).toEqual(["a"]);
    });

    it("returns an empty page (not a throw) for a malformed accountId", async () => {
      await repo.upsertFromSync(baseInput({ providerTransactionId: "a" }));

      const { items, hasMore } = await repo.findPageForUser("user-1", {
        page: 1,
        pageSize: 10,
        accountId: "not-a-valid-object-id",
      });

      expect(items).toEqual([]);
      expect(hasMore).toBe(false);
    });
  });

  describe("getTransactionTotals", () => {
    it("splits income and expenses, both returned as positive totals (WEB-13)", async () => {
      await repo.upsertFromSync(baseInput({ providerTransactionId: "paycheck", amount: -200_000 }));
      await repo.upsertFromSync(baseInput({ providerTransactionId: "groceries", amount: 4_000 }));
      await repo.upsertFromSync(baseInput({ providerTransactionId: "dining", amount: 2_500 }));

      const totals = await repo.getTransactionTotals("user-1", {});
      expect(totals).toEqual({ income: 200_000, expenses: 6_500 });
    });

    it("excludes transfer-matched transactions from both sides", async () => {
      const matched = await repo.upsertFromSync(
        baseInput({ providerTransactionId: "internal", amount: -5_000 }),
      );
      await repo.applyTransferMatch("user-1", [matched._id.toString()], "group-1");
      await repo.upsertFromSync(baseInput({ providerTransactionId: "groceries", amount: 4_000 }));

      const totals = await repo.getTransactionTotals("user-1", {});
      expect(totals).toEqual({ income: 0, expenses: 4_000 });
    });

    it("excludes soft-removed transactions", async () => {
      await repo.upsertFromSync(baseInput({ providerTransactionId: "removed", amount: 4_000 }));
      await repo.markRemoved("removed");

      const totals = await repo.getTransactionTotals("user-1", {});
      expect(totals).toEqual({ income: 0, expenses: 0 });
    });

    it("scopes to an inclusive dateFrom/dateTo window when given", async () => {
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "in-range",
          date: new Date("2026-01-15"),
          amount: 4_000,
        }),
      );
      await repo.upsertFromSync(
        baseInput({
          providerTransactionId: "out-of-range",
          date: new Date("2026-02-01"),
          amount: 9_000,
        }),
      );

      const totals = await repo.getTransactionTotals("user-1", {
        dateFrom: new Date("2026-01-01"),
        dateTo: new Date("2026-01-31"),
      });
      expect(totals).toEqual({ income: 0, expenses: 4_000 });
    });

    it("returns zero totals for a range with no matching transactions (no throw on the empty $group)", async () => {
      const totals = await repo.getTransactionTotals("user-1", {});
      expect(totals).toEqual({ income: 0, expenses: 0 });
    });

    it("scopes to an exact accountId match when given", async () => {
      const accountA = new mongoose.Types.ObjectId();
      const accountB = new mongoose.Types.ObjectId();
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "a", accountId: accountA, amount: 4_000 }),
      );
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "b", accountId: accountB, amount: 9_000 }),
      );

      const totals = await repo.getTransactionTotals("user-1", { accountId: accountA.toString() });
      expect(totals).toEqual({ income: 0, expenses: 4_000 });
    });

    it("returns zero totals (not a throw) for a malformed accountId", async () => {
      await repo.upsertFromSync(baseInput({ providerTransactionId: "a", amount: 4_000 }));

      const totals = await repo.getTransactionTotals("user-1", {
        accountId: "not-a-valid-object-id",
      });
      expect(totals).toEqual({ income: 0, expenses: 0 });
    });

    it("is scoped to the requesting user", async () => {
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "mine", userId: "user-1", amount: 4_000 }),
      );
      await repo.upsertFromSync(
        baseInput({ providerTransactionId: "theirs", userId: "user-2", amount: 9_000 }),
      );

      const totals = await repo.getTransactionTotals("user-1", {});
      expect(totals).toEqual({ income: 0, expenses: 4_000 });
    });
  });

  describe("updateMerchantNameOverrideForUser", () => {
    it("sets an override on a transaction the user owns", async () => {
      const created = await repo.upsertFromSync(baseInput());
      const updated = await repo.updateMerchantNameOverrideForUser(
        "user-1",
        created._id.toString(),
        "Trader Joe's (weekly groceries)",
      );
      expect(updated?.merchantNameOverride).toBe("Trader Joe's (weekly groceries)");
    });

    it("never touches merchantNameNormalized -- Tier 1/2 and subscription grouping still key off it", async () => {
      const created = await repo.upsertFromSync(baseInput());
      const updated = await repo.updateMerchantNameOverrideForUser(
        "user-1",
        created._id.toString(),
        "Weekly Groceries",
      );
      expect(updated?.merchantNameNormalized).toBe("trader joes");
    });

    it("returns null (and leaves the transaction untouched) for a different user", async () => {
      const created = await repo.upsertFromSync(baseInput());
      const result = await repo.updateMerchantNameOverrideForUser(
        "user-2",
        created._id.toString(),
        "Nope",
      );
      expect(result).toBeNull();

      const unchanged = await repo.findById(created._id.toString());
      expect(unchanged?.merchantNameOverride).toBeUndefined();
    });

    it("clears an existing override when passed null", async () => {
      const created = await repo.upsertFromSync(baseInput());
      await repo.updateMerchantNameOverrideForUser("user-1", created._id.toString(), "Custom Name");

      const cleared = await repo.updateMerchantNameOverrideForUser(
        "user-1",
        created._id.toString(),
        null,
      );
      expect(cleared?.merchantNameOverride).toBeUndefined();
    });

    it("returns null (not a throw) for a malformed id", async () => {
      const result = await repo.updateMerchantNameOverrideForUser(
        "user-1",
        "not-a-valid-object-id",
        "x",
      );
      expect(result).toBeNull();
    });
  });
});
