import { describe, it, expect } from "vitest";
import { resolveTier3Outcome } from "./tier3.js";

const THRESHOLD = 0.7;

function result(
  overrides: Partial<{
    transactionId: string;
    category: string;
    confidence: number;
    uncertain: boolean;
  }> = {},
) {
  return {
    transactionId: "txn-1",
    category: "Dining",
    confidence: 0.9,
    uncertain: false,
    ...overrides,
  };
}

describe("resolveTier3Outcome", () => {
  it("confirms a confident, non-uncertain result", () => {
    const category = resolveTier3Outcome(result({ confidence: 0.9, uncertain: false }), THRESHOLD);
    expect(category.status).toBe("confirmed");
  });

  it("treats the threshold as inclusive, matching Tier 2's fuzzy-match convention", () => {
    const category = resolveTier3Outcome(result({ confidence: 0.7, uncertain: false }), THRESHOLD);
    expect(category.status).toBe("confirmed");
  });

  it("sends a below-threshold confidence to review even when the model isn't flagged uncertain", () => {
    const category = resolveTier3Outcome(result({ confidence: 0.69, uncertain: false }), THRESHOLD);
    expect(category.status).toBe("needs_review");
  });

  it("sends an uncertain result to review even when its confidence score is high", () => {
    // A model saying "I'm not sure" is a real signal on its own -- a high
    // numeric score alongside it doesn't override that.
    const category = resolveTier3Outcome(result({ confidence: 0.95, uncertain: true }), THRESHOLD);
    expect(category.status).toBe("needs_review");
  });

  it("sends the parse-failure fallback (confidence 0, uncertain true) to review", () => {
    const category = resolveTier3Outcome(
      result({ category: "Uncategorized", confidence: 0, uncertain: true }),
      THRESHOLD,
    );
    expect(category.status).toBe("needs_review");
    expect(category.value).toBe("Uncategorized");
  });

  it("always tags tier 3, never the tier 4 sync placeholder", () => {
    const confirmed = resolveTier3Outcome(result({ confidence: 0.9, uncertain: false }), THRESHOLD);
    const review = resolveTier3Outcome(result({ confidence: 0.1, uncertain: true }), THRESHOLD);
    expect(confirmed.tier).toBe(3);
    expect(review.tier).toBe(3);
  });

  it("carries the confidence score through even for a confirmed result", () => {
    // Kept for provenance/debugging, not just to decide needs_review --
    // Tier 1/2 omit `confidence` entirely (it's only meaningful for tier
    // 3, per TransactionCategory's own doc comment), but tier 3 always
    // sets it, confirmed or not.
    const category = resolveTier3Outcome(result({ confidence: 0.83, uncertain: false }), THRESHOLD);
    expect(category.confidence).toBe(0.83);
  });

  it("passes the category value through unchanged", () => {
    const category = resolveTier3Outcome(result({ category: "Groceries" }), THRESHOLD);
    expect(category.value).toBe("Groceries");
  });

  it("a confidence of exactly 0 with uncertain false still needs review under any positive threshold", () => {
    const category = resolveTier3Outcome(result({ confidence: 0, uncertain: false }), THRESHOLD);
    expect(category.status).toBe("needs_review");
  });
});
