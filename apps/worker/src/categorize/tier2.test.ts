import { describe, it, expect } from "vitest";
import { resolveTier2Regex, resolveTier2Fuzzy, resolveTier2 } from "./tier2.js";

describe("resolveTier2Regex", () => {
  it("matches a description against a user-authored regex pattern", () => {
    const rules = [{ pattern: "UBER \\*TRIP", category: "Transportation", priority: 0 }];
    expect(resolveTier2Regex("UBER *TRIP 8QK2P", rules)).toEqual({
      tier: 2,
      value: "Transportation",
      status: "confirmed",
    });
  });

  it("matches case-insensitively without the author adding a flag", () => {
    const rules = [{ pattern: "netflix", category: "Subscriptions", priority: 0 }];
    expect(resolveTier2Regex("NETFLIX.COM", rules)?.value).toBe("Subscriptions");
  });

  it("evaluates lower priority numbers first", () => {
    const rules = [
      { pattern: "coffee", category: "Dining", priority: 5 },
      { pattern: "coffee", category: "Specialty Coffee", priority: 1 },
    ];
    // Both match; priority 1 must win regardless of array order.
    expect(resolveTier2Regex("Blue Bottle Coffee", rules)?.value).toBe("Specialty Coffee");
  });

  it("breaks a priority tie by insertion order", () => {
    const rules = [
      { pattern: "shop", category: "First", priority: 1 },
      { pattern: "shop", category: "Second", priority: 1 },
    ];
    expect(resolveTier2Regex("Corner Shop", rules)?.value).toBe("First");
  });

  it("skips a rule with an unparsable pattern instead of throwing", () => {
    // "[" is an unterminated character class -- invalid regex syntax. A
    // user-authored rule that fails to compile must not crash the sync job
    // for every transaction; it should just never match anything.
    const rules = [
      { pattern: "[", category: "Broken", priority: 0 },
      { pattern: "shop", category: "Retail", priority: 1 },
    ];
    expect(resolveTier2Regex("Corner Shop", rules)?.value).toBe("Retail");
  });

  it("returns undefined when no rule matches", () => {
    const rules = [{ pattern: "netflix", category: "Subscriptions", priority: 0 }];
    expect(resolveTier2Regex("Trader Joe's", rules)).toBeUndefined();
  });

  it("returns undefined against an empty rule list", () => {
    expect(resolveTier2Regex("anything", [])).toBeUndefined();
  });
});

describe("resolveTier2Fuzzy", () => {
  it("matches a normalized merchant close to a previously-corrected one", () => {
    // Same length (10), one substituted character -> similarity 0.9.
    const corrected = [{ normalizedMerchant: "aaaaaaaaaa", category: "Groceries" }];
    expect(resolveTier2Fuzzy("aaaaaaaaab", corrected)).toEqual({
      tier: 2,
      value: "Groceries",
      status: "confirmed",
    });
  });

  it("matches exactly at the threshold (inclusive)", () => {
    // Length 10, edit distance 2 -> similarity exactly 0.8.
    const corrected = [{ normalizedMerchant: "aaaaaaaaaa", category: "Groceries" }];
    expect(resolveTier2Fuzzy("aaaaaaaabb", corrected)?.value).toBe("Groceries");
  });

  it("rejects a candidate below the threshold", () => {
    const corrected = [{ normalizedMerchant: "aaaaaaaaaa", category: "Groceries" }];
    expect(resolveTier2Fuzzy("bbbbbbbbbb", corrected)).toBeUndefined();
  });

  it("picks the closest match when more than one clears the threshold", () => {
    const corrected = [
      { normalizedMerchant: "aaaaaaaaab", category: "OneEditAway" }, // similarity 0.9
      { normalizedMerchant: "aaaaaaaaaa", category: "ExactMatch" }, // similarity 1.0
    ];
    expect(resolveTier2Fuzzy("aaaaaaaaaa", corrected)?.value).toBe("ExactMatch");
  });

  it("returns undefined for an empty normalized merchant", () => {
    expect(
      resolveTier2Fuzzy("", [{ normalizedMerchant: "uber", category: "Transportation" }]),
    ).toBeUndefined();
  });

  it("returns undefined against an empty corrected-merchant list", () => {
    expect(resolveTier2Fuzzy("uber", [])).toBeUndefined();
  });
});

describe("resolveTier2 (composed)", () => {
  it("prefers an explicit regex match over a fuzzy one", () => {
    const result = resolveTier2(
      { description: "UBER *TRIP", normalizedMerchant: "uber trip" },
      {
        regex: [{ pattern: "UBER", category: "Transportation", priority: 0 }],
        correctedMerchants: [{ normalizedMerchant: "uber trip", category: "Wrong Tier Would Win" }],
      },
    );
    expect(result?.value).toBe("Transportation");
  });

  it("falls through to fuzzy matching when no regex rule matches", () => {
    const result = resolveTier2(
      { description: "Corner Shop", normalizedMerchant: "aaaaaaaaab" },
      {
        regex: [{ pattern: "netflix", category: "Subscriptions", priority: 0 }],
        correctedMerchants: [{ normalizedMerchant: "aaaaaaaaaa", category: "Groceries" }],
      },
    );
    expect(result?.value).toBe("Groceries");
  });

  it("returns undefined when neither regex nor fuzzy matches", () => {
    const result = resolveTier2(
      { description: "Corner Shop", normalizedMerchant: "corner shop" },
      { regex: [], correctedMerchants: [] },
    );
    expect(result).toBeUndefined();
  });
});
