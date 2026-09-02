import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { setupTestDb } from "../test/mongo-memory.js";
import { AccountRepository } from "./AccountRepository.js";

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
});
