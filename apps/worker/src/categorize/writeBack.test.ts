import { describe, it, expect } from "vitest";
import type { TransactionCategory } from "@financial-os/db";
import { buildMerchantRuleWriteBack } from "./writeBack.js";

function category(overrides: Partial<TransactionCategory> = {}): TransactionCategory {
  return { tier: 3, value: "Transportation", confidence: 0.9, status: "confirmed", ...overrides };
}

describe("buildMerchantRuleWriteBack", () => {
  it("returns a write-back payload for a confirmed category", () => {
    const result = buildMerchantRuleWriteBack("user-1", "uber", category(), "llm");
    expect(result).toEqual({
      userId: "user-1",
      pattern: "uber",
      category: "Transportation",
      source: "llm",
    });
  });

  it("returns null for a needs_review category", () => {
    const result = buildMerchantRuleWriteBack(
      "user-1",
      "uber",
      category({ status: "needs_review" }),
      "llm",
    );
    expect(result).toBeNull();
  });

  it("passes the source through unchanged", () => {
    const result = buildMerchantRuleWriteBack("user-1", "uber", category(), "manual");
    expect(result?.source).toBe("manual");
  });

  it("uses category.value, not category.tier or confidence, as the rule's category", () => {
    const result = buildMerchantRuleWriteBack(
      "user-1",
      "uber",
      category({ tier: 1, value: "Rideshare", confidence: undefined }),
      "llm",
    );
    expect(result?.category).toBe("Rideshare");
  });

  it("does not normalize or otherwise transform the merchant pattern -- that is the caller's job", () => {
    const result = buildMerchantRuleWriteBack("user-1", "UBER  *trip", category(), "llm");
    expect(result?.pattern).toBe("UBER  *trip");
  });
});
