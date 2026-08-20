import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { setupTestDb } from "../test/mongo-memory.js";
import { TransactionRepository, type UpsertTransactionInput } from "./TransactionRepository.js";

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
    await repo.upsertFromSync(
      baseInput({
        category: { tier: 3, value: "Dining", confidence: 0.8, status: "needs_review" },
      }),
    );

    const all = await repo.findByUserAndDateRange("user-1", {
      start: new Date("2026-01-01"),
      end: new Date("2026-01-31"),
    });
    expect(all).toHaveLength(1);
    expect(all[0]?.category.value).toBe("Dining");
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

  it("applyTransferMatch links both sides and excludes them from cash flow", async () => {
    const a = await repo.upsertFromSync(baseInput({ providerTransactionId: "out", amount: -5000 }));
    const b = await repo.upsertFromSync(baseInput({ providerTransactionId: "in", amount: 5000 }));

    await repo.applyTransferMatch([a._id.toString(), b._id.toString()], "group-1");

    const results = await repo.findByUserAndDateRange("user-1", {
      start: new Date("2026-01-01"),
      end: new Date("2026-01-31"),
    });
    for (const txn of results) {
      expect(txn.transferGroupId).toBe("group-1");
      expect(txn.excludeFromCashFlow).toBe(true);
    }
  });
});
