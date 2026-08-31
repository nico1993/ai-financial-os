import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { setupTestDb } from "../test/mongo-memory.js";
import {
  SubscriptionRepository,
  type UpsertDetectedSubscriptionInput,
} from "./SubscriptionRepository.js";

const db = setupTestDb();
const repo = new SubscriptionRepository();

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

function baseInput(
  overrides: Partial<UpsertDetectedSubscriptionInput> = {},
): UpsertDetectedSubscriptionInput {
  return {
    userId: "user-1",
    merchantNameNormalized: "netflix",
    merchantName: "Netflix",
    amount: 1_599,
    intervalDays: 30,
    frequency: "monthly",
    lastTransactionDate: new Date("2026-01-01"),
    nextExpectedDate: new Date("2026-01-31"),
    transactionIds: [
      new mongoose.Types.ObjectId().toString(),
      new mongoose.Types.ObjectId().toString(),
    ],
    ...overrides,
  };
}

describe("SubscriptionRepository", () => {
  it("upsertDetected creates a new subscription, active by default", async () => {
    const created = await repo.upsertDetected(baseInput());
    expect(created.merchantNameNormalized).toBe("netflix");
    expect(created.active).toBe(true);
    expect(created.transactionIds).toHaveLength(2);
  });

  it("upsertDetected updates the same merchant instead of duplicating it", async () => {
    await repo.upsertDetected(baseInput());
    await repo.upsertDetected(
      baseInput({ amount: 1_699, lastTransactionDate: new Date("2026-02-01") }),
    );

    const active = await repo.findActiveByUser("user-1");
    expect(active).toHaveLength(1);
    expect(active[0]?.amount).toBe(1_699);
  });

  it("stores transactionIds as real ObjectIds from plain string ids", async () => {
    const id1 = new mongoose.Types.ObjectId().toString();
    const id2 = new mongoose.Types.ObjectId().toString();
    await repo.upsertDetected(baseInput({ transactionIds: [id1, id2] }));

    const active = await repo.findActiveByUser("user-1");
    expect(active[0]?.transactionIds.map((id) => id.toString())).toEqual([id1, id2]);
  });

  it("findActiveByUser only returns active subscriptions, scoped to the user", async () => {
    await repo.upsertDetected(
      baseInput({ merchantNameNormalized: "netflix", merchantName: "Netflix" }),
    );
    await repo.upsertDetected(
      baseInput({ merchantNameNormalized: "spotify", merchantName: "Spotify", userId: "user-2" }),
    );
    await repo.markInactive("user-1", "netflix");
    await repo.upsertDetected(baseInput({ merchantNameNormalized: "hulu", merchantName: "Hulu" }));

    const active = await repo.findActiveByUser("user-1");
    expect(active.map((s) => s.merchantNameNormalized)).toEqual(["hulu"]);
  });

  it("markInactive is a no-op when the merchant has no subscription row yet", async () => {
    await expect(repo.markInactive("user-1", "nonexistent")).resolves.toBeUndefined();
  });

  it("re-activates a lapsed subscription if detection confirms it again later", async () => {
    await repo.upsertDetected(baseInput());
    await repo.markInactive("user-1", "netflix");
    expect(await repo.findActiveByUser("user-1")).toEqual([]);

    await repo.upsertDetected(baseInput({ lastTransactionDate: new Date("2026-05-01") }));
    const active = await repo.findActiveByUser("user-1");
    expect(active).toHaveLength(1);
    expect(active[0]?.active).toBe(true);
  });
});
