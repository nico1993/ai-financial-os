import { describe, it, expect } from "vitest";
import {
  extractJsonPayload,
  parseCategorizationArray,
  reconcileCategorizationResults,
} from "./ollamaResponseParsing.js";

describe("extractJsonPayload", () => {
  it("returns clean JSON unchanged", () => {
    expect(extractJsonPayload('[{"a":1}]')).toBe('[{"a":1}]');
  });

  it("strips a markdown code fence", () => {
    expect(extractJsonPayload('```json\n[{"a":1}]\n```')).toBe('[{"a":1}]');
  });

  it("strips a code fence with no language tag", () => {
    expect(extractJsonPayload('```\n[{"a":1}]\n```')).toBe('[{"a":1}]');
  });

  it("extracts the outermost array when the model leaked commentary around it", () => {
    expect(extractJsonPayload('Sure, here you go:\n[{"a":1}]\nHope that helps!')).toBe('[{"a":1}]');
  });

  it("falls back to the trimmed original when nothing recognizable is found", () => {
    expect(extractJsonPayload("  not json at all  ")).toBe("not json at all");
  });
});

describe("parseCategorizationArray", () => {
  it("parses a clean JSON array", () => {
    expect(parseCategorizationArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("parses a fenced JSON array", () => {
    expect(parseCategorizationArray('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });

  it("returns null for unparsable content", () => {
    expect(parseCategorizationArray("The user says \n\n\t}\n \t\t \t\t")).toBeNull();
  });

  it("returns null when the JSON parses but isn't an array", () => {
    expect(parseCategorizationArray('{"a":1}')).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseCategorizationArray("")).toBeNull();
  });
});

describe("reconcileCategorizationResults", () => {
  const candidates = [{ transactionId: "tx-1" }, { transactionId: "tx-2" }];

  it("maps each valid entry onto its candidate", () => {
    const parsed = [
      { transactionId: "tx-1", category: "Groceries", confidence: 0.9, uncertain: false },
      { transactionId: "tx-2", category: "Dining", confidence: 0.6, uncertain: false },
    ];
    expect(reconcileCategorizationResults(parsed, candidates)).toEqual([
      { transactionId: "tx-1", category: "Groceries", confidence: 0.9, uncertain: false },
      { transactionId: "tx-2", category: "Dining", confidence: 0.6, uncertain: false },
    ]);
  });

  it("falls back to an uncertain, zero-confidence result for a missing entry", () => {
    const parsed = [
      { transactionId: "tx-1", category: "Groceries", confidence: 0.9, uncertain: false },
    ];
    expect(reconcileCategorizationResults(parsed, candidates)).toEqual([
      { transactionId: "tx-1", category: "Groceries", confidence: 0.9, uncertain: false },
      { transactionId: "tx-2", category: "Uncategorized", confidence: 0, uncertain: true },
    ]);
  });

  it("falls back for an entry with an invalid field type instead of dropping the whole batch", () => {
    const parsed = [
      { transactionId: "tx-1", category: "Groceries", confidence: "high", uncertain: false },
      { transactionId: "tx-2", category: "Dining", confidence: 0.6, uncertain: false },
    ];
    const result = reconcileCategorizationResults(parsed, candidates);
    expect(result.find((r) => r.transactionId === "tx-1")).toEqual({
      transactionId: "tx-1",
      category: "Uncategorized",
      confidence: 0,
      uncertain: true,
    });
    expect(result.find((r) => r.transactionId === "tx-2")?.category).toBe("Dining");
  });

  it("falls back for a confidence outside 0..1", () => {
    const parsed = [
      { transactionId: "tx-1", category: "Groceries", confidence: 1.5, uncertain: false },
    ];
    expect(reconcileCategorizationResults(parsed, candidates)[0]?.uncertain).toBe(true);
  });

  it("falls back for a blank category string", () => {
    const parsed = [{ transactionId: "tx-1", category: "  ", confidence: 0.9, uncertain: false }];
    expect(reconcileCategorizationResults(parsed, candidates)[0]?.uncertain).toBe(true);
  });

  it("ignores an entry for a transactionId that was never a candidate", () => {
    const parsed = [
      { transactionId: "tx-1", category: "Groceries", confidence: 0.9, uncertain: false },
      { transactionId: "tx-unknown", category: "Dining", confidence: 0.6, uncertain: false },
      { transactionId: "tx-2", category: "Dining", confidence: 0.6, uncertain: false },
    ];
    const result = reconcileCategorizationResults(parsed, candidates);
    expect(result.map((r) => r.transactionId)).toEqual(["tx-1", "tx-2"]);
  });

  it("keeps the last entry on a duplicate transactionId", () => {
    const parsed = [
      { transactionId: "tx-1", category: "First", confidence: 0.5, uncertain: false },
      { transactionId: "tx-1", category: "Second", confidence: 0.9, uncertain: false },
      { transactionId: "tx-2", category: "Dining", confidence: 0.6, uncertain: false },
    ];
    expect(reconcileCategorizationResults(parsed, candidates)[0]?.category).toBe("Second");
  });

  it("returns an empty array for an empty candidate list", () => {
    expect(reconcileCategorizationResults([], [])).toEqual([]);
  });

  it("passes the model's own uncertain:true through rather than treating it as a parse failure", () => {
    const parsed = [{ transactionId: "tx-1", category: "Fees", confidence: 0.3, uncertain: true }];
    expect(reconcileCategorizationResults(parsed, [{ transactionId: "tx-1" }])).toEqual([
      { transactionId: "tx-1", category: "Fees", confidence: 0.3, uncertain: true },
    ]);
  });
});
