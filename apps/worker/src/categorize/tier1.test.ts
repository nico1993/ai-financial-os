import { describe, it, expect } from "vitest";
import { buildTier1Index, resolveTier1 } from "./tier1.js";

describe("resolveTier1", () => {
  it("returns a confirmed tier-1 category on an exact-match hit", () => {
    const index = buildTier1Index([{ pattern: "netflix com", category: "Subscriptions" }]);
    expect(resolveTier1("netflix com", index)).toEqual({
      tier: 1,
      value: "Subscriptions",
      status: "confirmed",
    });
  });

  it("returns undefined on a miss, not a placeholder category", () => {
    const index = buildTier1Index([{ pattern: "netflix com", category: "Subscriptions" }]);
    expect(resolveTier1("hulu com", index)).toBeUndefined();
  });

  it("returns undefined against an empty index", () => {
    expect(resolveTier1("uber", buildTier1Index([]))).toBeUndefined();
  });

  it("never sets confidence -- that field only means something for Tier 3", () => {
    const index = buildTier1Index([{ pattern: "uber", category: "Transportation" }]);
    const result = resolveTier1("uber", index);
    expect(result?.confidence).toBeUndefined();
  });

  it("does not normalize -- it trusts the caller already normalized the key", () => {
    // The lookup key on file is normalized ("uber"); an unnormalized probe
    // ("Uber", capitalized) must miss rather than silently re-normalizing
    // here and duplicating sync/normalize.ts's job.
    const index = buildTier1Index([{ pattern: "uber", category: "Transportation" }]);
    expect(resolveTier1("Uber", index)).toBeUndefined();
  });
});

describe("buildTier1Index", () => {
  it("indexes each rule by its pattern", () => {
    const index = buildTier1Index([
      { pattern: "uber", category: "Transportation" },
      { pattern: "netflix com", category: "Subscriptions" },
    ]);
    expect(index.get("uber")).toBe("Transportation");
    expect(index.get("netflix com")).toBe("Subscriptions");
    expect(index.size).toBe(2);
  });

  it("returns an empty index for an empty rule list", () => {
    expect(buildTier1Index([]).size).toBe(0);
  });

  it("is last-one-wins on a duplicate pattern rather than throwing", () => {
    // The unique (userId, pattern) index on MerchantRule (ADR-0004/DATA-5)
    // means this can't happen from one user's real rows, but this function
    // has no visibility into that constraint -- it just needs a defined,
    // non-throwing behavior for whatever list it's handed.
    const index = buildTier1Index([
      { pattern: "uber", category: "Transportation" },
      { pattern: "uber", category: "Rideshare" },
    ]);
    expect(index.get("uber")).toBe("Rideshare");
    expect(index.size).toBe(1);
  });
});
