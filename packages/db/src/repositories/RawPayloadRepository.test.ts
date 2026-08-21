import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../test/mongo-memory.js";
import { RawPayloadRepository, type InsertRawPayloadInput } from "./RawPayloadRepository.js";

const db = setupTestDb();
const repo = new RawPayloadRepository();

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

function baseInput(overrides: Partial<InsertRawPayloadInput> = {}): InsertRawPayloadInput {
  return {
    userId: "user-1",
    source: "plaid",
    type: "transaction",
    providerId: "txn-1",
    payload: { transaction_id: "txn-1", amount: 42.5, pending: true },
    ...overrides,
  };
}

describe("RawPayloadRepository", () => {
  it("insert stores the payload untouched", async () => {
    await repo.insert(baseInput());

    const found = await repo.findByProviderId("user-1", "transaction", "txn-1");
    expect(found).toHaveLength(1);
    expect(found[0]?.payload).toEqual({ transaction_id: "txn-1", amount: 42.5, pending: true });
  });

  it("defaults receivedAt to now", async () => {
    await repo.insert(baseInput());

    const found = await repo.findByProviderId("user-1", "transaction", "txn-1");
    expect(found[0]?.receivedAt).toBeInstanceOf(Date);
  });

  it("appends rather than upserting — every version the provider sent is kept", async () => {
    // The whole point of §3.1: a pending payload and its later posted
    // correction must both survive, not overwrite each other.
    await repo.insert(
      baseInput({ payload: { pending: true }, receivedAt: new Date("2026-01-01") }),
    );
    await repo.insert(
      baseInput({ payload: { pending: false }, receivedAt: new Date("2026-01-03") }),
    );

    const found = await repo.findByProviderId("user-1", "transaction", "txn-1");
    expect(found).toHaveLength(2);
  });

  it("findByProviderId returns oldest-first so corrections replay in order", async () => {
    await repo.insert(baseInput({ payload: { v: 2 }, receivedAt: new Date("2026-01-03") }));
    await repo.insert(baseInput({ payload: { v: 1 }, receivedAt: new Date("2026-01-01") }));

    const found = await repo.findByProviderId("user-1", "transaction", "txn-1");
    expect(found.map((p) => (p.payload as { v: number }).v)).toEqual([1, 2]);
  });

  it("scopes reads by user, type, and providerId", async () => {
    await repo.insert(baseInput());
    await repo.insert(baseInput({ userId: "user-2" }));
    await repo.insert(baseInput({ type: "account" }));
    await repo.insert(baseInput({ providerId: "txn-2" }));

    const found = await repo.findByProviderId("user-1", "transaction", "txn-1");
    expect(found).toHaveLength(1);
  });
});
