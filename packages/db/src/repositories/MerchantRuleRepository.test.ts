import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../test/mongo-memory.js";
import { MerchantRuleModel } from "../models/MerchantRule.js";
import { MerchantRuleRepository } from "./MerchantRuleRepository.js";

const db = setupTestDb();
const repo = new MerchantRuleRepository();

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

function rule(overrides: Partial<Parameters<typeof MerchantRuleModel.create>[0]> = {}) {
  return {
    userId: "user-1",
    tier: 1 as const,
    matchType: "exact" as const,
    pattern: "uber",
    category: "Transportation",
    priority: 0,
    source: "manual" as const,
    ...overrides,
  };
}

describe("MerchantRuleRepository", () => {
  it("findExactByUser returns only that user's exact-match rules", async () => {
    await MerchantRuleModel.create(rule());
    await MerchantRuleModel.create(rule({ userId: "user-2", category: "Rideshare" }));

    const results = await repo.findExactByUser("user-1");
    expect(results).toHaveLength(1);
    expect(results[0]?.category).toBe("Transportation");
  });

  it("findExactByUser excludes that same user's regex rules", async () => {
    await MerchantRuleModel.create(rule({ tier: 2, matchType: "regex", pattern: "UBER \\*TRIP" }));

    expect(await repo.findExactByUser("user-1")).toHaveLength(0);
  });

  it("findRegexByUser returns only that user's regex rules", async () => {
    await MerchantRuleModel.create(
      rule({ tier: 2, matchType: "regex", pattern: "shop", category: "Retail" }),
    );
    await MerchantRuleModel.create(rule()); // an exact rule for the same user
    await MerchantRuleModel.create(
      rule({
        userId: "user-2",
        tier: 2,
        matchType: "regex",
        pattern: "shop",
        category: "Other User",
      }),
    );

    const results = await repo.findRegexByUser("user-1");
    expect(results.map((r) => r.category)).toEqual(["Retail"]);
  });

  it("enforces one exact rule per (userId, pattern)", async () => {
    await MerchantRuleModel.create(rule());
    await expect(MerchantRuleModel.create(rule({ category: "Rideshare" }))).rejects.toThrow(
      /duplicate key|E11000/,
    );
  });

  describe("upsertExact", () => {
    it("inserts a new Tier 1 rule when none exists for this (userId, pattern)", async () => {
      await repo.upsertExact({
        userId: "user-1",
        pattern: "uber",
        category: "Transportation",
        source: "llm",
      });

      const results = await repo.findExactByUser("user-1");
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        tier: 1,
        matchType: "exact",
        pattern: "uber",
        category: "Transportation",
        priority: 0,
        source: "llm",
      });
    });

    it("overwrites the category/source of an existing rule for the same (userId, pattern)", async () => {
      await MerchantRuleModel.create(rule({ category: "Transportation", source: "manual" }));

      await repo.upsertExact({
        userId: "user-1",
        pattern: "uber",
        category: "Rideshare",
        source: "llm",
      });

      const results = await repo.findExactByUser("user-1");
      expect(results).toHaveLength(1);
      expect(results[0]?.category).toBe("Rideshare");
      expect(results[0]?.source).toBe("llm");
    });

    it("is scoped per user -- writing back for one user doesn't touch another's rule", async () => {
      await MerchantRuleModel.create(rule({ userId: "user-2", category: "Groceries" }));

      await repo.upsertExact({
        userId: "user-1",
        pattern: "uber",
        category: "Transportation",
        source: "llm",
      });

      const otherUser = await repo.findExactByUser("user-2");
      expect(otherUser).toHaveLength(1);
      expect(otherUser[0]?.category).toBe("Groceries");
    });

    it("never creates a Tier 2 (regex) row -- upsertExact is exact-match only", async () => {
      await repo.upsertExact({
        userId: "user-1",
        pattern: "uber",
        category: "Transportation",
        source: "llm",
      });

      expect(await repo.findRegexByUser("user-1")).toHaveLength(0);
    });
  });
});
