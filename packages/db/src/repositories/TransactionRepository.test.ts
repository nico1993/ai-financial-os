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
    await repo.applyTransferMatch([grouped._id.toString()], "group-existing");

    const results = await repo.findUnmatchedTransferCandidates("user-1");
    expect(results.map((tx) => tx.providerTransactionId)).toEqual(["eligible"]);
  });

  it("findUnmatchedTransferCandidates is scoped to the requesting user", async () => {
    await repo.upsertFromSync(baseInput({ providerTransactionId: "mine", userId: "user-1" }));
    await repo.upsertFromSync(baseInput({ providerTransactionId: "theirs", userId: "user-2" }));

    const results = await repo.findUnmatchedTransferCandidates("user-1");
    expect(results.map((tx) => tx.providerTransactionId)).toEqual(["mine"]);
  });
});
