import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { setupTestDb } from "../test/mongo-memory.js";
import { AccountRepository } from "./AccountRepository.js";
import { AccountModel } from "../models/Account.js";

const db = setupTestDb();
const repo = new AccountRepository();

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

function baseInput(overrides: Partial<Parameters<AccountRepository["upsertFromSync"]>[0]> = {}) {
  return {
    userId: "user-1",
    connectionId: new mongoose.Types.ObjectId(),
    provider: "plaid" as const,
    providerAccountId: "account-1",
    institutionName: "Chase",
    type: "depository" as const,
    subtype: "checking",
    currentBalance: 10_000,
    isoCurrencyCode: "USD",
    ...overrides,
  };
}

describe("AccountRepository", () => {
  it("upsertFromSync creates a new account", async () => {
    const created = await repo.upsertFromSync(baseInput());
    expect(created.currentBalance).toBe(10_000);
  });

  it("upsertFromSync updates balance on the same account instead of duplicating it", async () => {
    await repo.upsertFromSync(baseInput());
    await repo.upsertFromSync(baseInput({ currentBalance: 9_500 }));

    const all = await repo.findByUserId("user-1");
    expect(all).toHaveLength(1);
    expect(all[0]?.currentBalance).toBe(9_500);
  });

  it("findById returns the account", async () => {
    const created = await repo.upsertFromSync(baseInput());
    const found = await repo.findById(created._id.toString());
    expect(found?.providerAccountId).toBe("account-1");
  });

  it("findByConnectionId scopes to the given connection", async () => {
    const connectionId = new mongoose.Types.ObjectId();
    await repo.upsertFromSync(baseInput({ connectionId, providerAccountId: "a1" }));
    await repo.upsertFromSync(
      baseInput({ connectionId: new mongoose.Types.ObjectId(), providerAccountId: "a2" }),
    );

    const results = await repo.findByConnectionId(connectionId.toString());
    expect(results).toHaveLength(1);
    expect(results[0]?.providerAccountId).toBe("a1");
  });

  describe("updateNickname", () => {
    it("sets a nickname on an account the user owns", async () => {
      const created = await repo.upsertFromSync(baseInput());
      const updated = await repo.updateNickname("user-1", created._id.toString(), "Joint Checking");
      expect(updated?.nickname).toBe("Joint Checking");
    });

    it("returns null for an account owned by a different user, and leaves it untouched", async () => {
      const created = await repo.upsertFromSync(baseInput());
      const result = await repo.updateNickname("user-2", created._id.toString(), "Nope");
      expect(result).toBeNull();

      const unchanged = await repo.findById(created._id.toString());
      expect(unchanged?.nickname).toBeUndefined();
    });

    it("clears an existing nickname when passed null", async () => {
      const created = await repo.upsertFromSync(baseInput());
      await repo.updateNickname("user-1", created._id.toString(), "Joint Checking");

      const cleared = await repo.updateNickname("user-1", created._id.toString(), null);
      expect(cleared?.nickname).toBeUndefined();
    });

    it("returns null (not a throw) for a malformed id", async () => {
      const result = await repo.updateNickname("user-1", "not-a-valid-object-id", "x");
      expect(result).toBeNull();
    });

    it("a resync never overwrites a nickname the user set", async () => {
      const created = await repo.upsertFromSync(baseInput());
      await repo.updateNickname("user-1", created._id.toString(), "Joint Checking");

      // upsertFromSync's $set never includes `nickname` -- UpsertAccountInput
      // has no such field, so there is nothing for a resync to pass here.
      await repo.upsertFromSync(baseInput({ currentBalance: 8_000 }));

      const after = await repo.findById(created._id.toString());
      expect(after?.nickname).toBe("Joint Checking");
      expect(after?.currentBalance).toBe(8_000);
    });
  });

  describe("archive", () => {
    it("marks an account the user owns as archived", async () => {
      const created = await repo.upsertFromSync(baseInput());
      const archived = await repo.archive("user-1", created._id.toString());
      expect(archived?.archived).toBe(true);
    });

    it("returns null for an account owned by a different user, and leaves it untouched", async () => {
      const created = await repo.upsertFromSync(baseInput());
      const result = await repo.archive("user-2", created._id.toString());
      expect(result).toBeNull();

      const unchanged = await repo.findById(created._id.toString());
      expect(unchanged?.archived).toBe(false);
    });

    it("returns null (not a throw) for a malformed id", async () => {
      const result = await repo.archive("user-1", "not-a-valid-object-id");
      expect(result).toBeNull();
    });

    it("does not touch sibling accounts under the same connection", async () => {
      const connectionId = new mongoose.Types.ObjectId();
      const checking = await repo.upsertFromSync(
        baseInput({ connectionId, providerAccountId: "checking-1" }),
      );
      const savings = await repo.upsertFromSync(
        baseInput({ connectionId, providerAccountId: "savings-1" }),
      );

      await repo.archive("user-1", checking._id.toString());

      const savingsAfter = await repo.findById(savings._id.toString());
      expect(savingsAfter?.archived).toBe(false);
    });
  });

  describe("findActiveByUser", () => {
    it("excludes an archived account", async () => {
      const kept = await repo.upsertFromSync(baseInput({ providerAccountId: "a1" }));
      const removed = await repo.upsertFromSync(baseInput({ providerAccountId: "a2" }));
      await repo.archive("user-1", removed._id.toString());

      const active = await repo.findActiveByUser("user-1");
      expect(active.map((a) => a._id.toString())).toEqual([kept._id.toString()]);
    });

    it("includes an account that predates the archived field entirely -- not just one explicitly set to false", async () => {
      // Simulate a real pre-ACCT-2 row: created before `archived` existed,
      // so it has no `archived` key stored at all -- not even the schema
      // default, since that only applies through Mongoose's own
      // create()/save() path. Unlike CAT-16's equivalent test for `kind`,
      // `archived` DOES have a schema default, so upsertFromSync() or
      // AccountModel.create() would apply it and defeat the point of this
      // test -- inserting through the raw collection bypasses Mongoose
      // entirely, the way a real row from before this migration actually
      // looks in the database.
      const raw = await AccountModel.collection.insertOne({
        userId: "user-1",
        connectionId: new mongoose.Types.ObjectId(),
        provider: "plaid",
        providerAccountId: "pre-migration-account",
        institutionName: "Chase",
        type: "depository",
        subtype: "checking",
        currentBalance: 5_000,
        isoCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Confirm the premise: a lean read genuinely sees archived:
      // undefined, not the schema's "false" default -- Mongoose does not
      // backfill schema defaults onto a document it didn't write itself.
      const preExisting = await repo.findById(raw.insertedId.toString());
      expect(preExisting?.archived).toBeUndefined();

      const active = await repo.findActiveByUser("user-1");
      expect(active.map((a) => a._id.toString())).toContain(raw.insertedId.toString());
    });
  });
});
