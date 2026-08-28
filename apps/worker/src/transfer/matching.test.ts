import { describe, it, expect } from "vitest";
import {
  findTransferMatches,
  isTransferSignalCategory,
  type TransferCandidateTransaction,
} from "./matching.js";

function tx(
  overrides: Partial<TransferCandidateTransaction> & { id: string },
): TransferCandidateTransaction {
  return {
    accountId: "acct-checking",
    amount: -5000,
    date: new Date("2026-01-10T00:00:00.000Z"),
    providerCategory: undefined,
    ...overrides,
  };
}

const OPTIONS = { dateToleranceDays: 3, amountToleranceCents: 100 };

describe("isTransferSignalCategory", () => {
  it("recognizes every TRANSFER_ detailed category by prefix", () => {
    expect(isTransferSignalCategory("TRANSFER_OUT_ACCOUNT_TRANSFER")).toBe(true);
    expect(isTransferSignalCategory("TRANSFER_IN_SAVINGS")).toBe(true);
  });

  it("recognizes a credit-card payment as a transfer signal", () => {
    expect(isTransferSignalCategory("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBe(true);
  });

  it("does not treat an unrelated loan payment as a transfer signal", () => {
    // Deliberately out of scope (ADR-0029): a mortgage/car/student/personal
    // loan payment typically leaves for a servicer this app has no linked
    // account for, so matching it would be a guess, not a documented case.
    expect(isTransferSignalCategory("LOAN_PAYMENTS_MORTGAGE_PAYMENT")).toBe(false);
  });

  it("rejects an ordinary spending category", () => {
    expect(isTransferSignalCategory("FOOD_AND_DRINK_GROCERIES")).toBe(false);
  });

  it("treats a missing category as no signal", () => {
    expect(isTransferSignalCategory(undefined)).toBe(false);
  });
});

describe("findTransferMatches", () => {
  it("matches an opposite-signed, equal-magnitude pair across accounts", () => {
    const candidates = [
      tx({
        id: "out",
        accountId: "checking",
        amount: -5000,
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      tx({
        id: "in",
        accountId: "savings",
        amount: 5000,
        providerCategory: "TRANSFER_IN_ACCOUNT_TRANSFER",
      }),
    ];
    const result = findTransferMatches(candidates, OPTIONS);
    expect(result).toHaveLength(1);
    // Both sides carry a transfer signal here, so either could end up
    // labeled the "anchor" depending on the deterministic (date, id)
    // visiting order (TransferMatchPair's own doc comment: no ordering
    // meaning beyond that, XFER-3 treats both ids identically) -- assert
    // the pair links "out" and "in" without pinning down which is which.
    expect([result[0]?.anchorId, result[0]?.counterpartId].sort()).toEqual(["in", "out"]);
  });

  it("matches when only one side carries a transfer signal", () => {
    const candidates = [
      tx({
        id: "out",
        accountId: "checking",
        amount: -5000,
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      tx({ id: "in", accountId: "savings", amount: 5000 }),
    ];
    expect(findTransferMatches(candidates, OPTIONS)).toEqual([
      { anchorId: "out", counterpartId: "in" },
    ]);
  });

  it("never matches two transactions in the same account", () => {
    const candidates = [
      tx({
        id: "a",
        accountId: "checking",
        amount: -5000,
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      tx({ id: "b", accountId: "checking", amount: 5000 }),
    ];
    expect(findTransferMatches(candidates, OPTIONS)).toEqual([]);
  });

  it("never matches two transactions with neither side carrying a transfer signal", () => {
    // Same amount, opposite sign, different accounts, same day -- but
    // nothing marks either side as an actual transfer. Could just as
    // easily be an unrelated coincidence (a refund landing the same day
    // as an unrelated charge), so §2.4 requires the signal on at least
    // one side before treating equal/opposite amounts as meaningful.
    const candidates = [
      tx({ id: "a", accountId: "checking", amount: -5000 }),
      tx({ id: "b", accountId: "savings", amount: 5000 }),
    ];
    expect(findTransferMatches(candidates, OPTIONS)).toEqual([]);
  });

  it("rejects a pair outside the date tolerance window", () => {
    const candidates = [
      tx({
        id: "out",
        accountId: "checking",
        amount: -5000,
        date: new Date("2026-01-01T00:00:00.000Z"),
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      tx({
        id: "in",
        accountId: "savings",
        amount: 5000,
        date: new Date("2026-01-10T00:00:00.000Z"),
      }),
    ];
    expect(findTransferMatches(candidates, OPTIONS)).toEqual([]);
  });

  it("matches within the amount tolerance to allow for a fee", () => {
    const candidates = [
      tx({
        id: "out",
        accountId: "checking",
        amount: -5000,
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      // $0.50 fee shaved off, within the $1.00 default tolerance.
      tx({ id: "in", accountId: "savings", amount: 4950 }),
    ];
    expect(findTransferMatches(candidates, OPTIONS)).toEqual([
      { anchorId: "out", counterpartId: "in" },
    ]);
  });

  it("rejects a pair beyond the amount tolerance", () => {
    const candidates = [
      tx({
        id: "out",
        accountId: "checking",
        amount: -5000,
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      // $2.00 gap, beyond the $1.00 default tolerance.
      tx({ id: "in", accountId: "savings", amount: 4800 }),
    ];
    expect(findTransferMatches(candidates, OPTIONS)).toEqual([]);
  });

  it("requires exact magnitude when amountToleranceCents is 0", () => {
    const strict = { dateToleranceDays: 3, amountToleranceCents: 0 };
    const candidates = [
      tx({
        id: "out",
        accountId: "checking",
        amount: -5000,
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      tx({ id: "in", accountId: "savings", amount: 4999 }),
    ];
    expect(findTransferMatches(candidates, strict)).toEqual([]);
  });

  it("picks the closer date when two counterparts both qualify", () => {
    const candidates = [
      tx({
        id: "out",
        accountId: "checking",
        amount: -5000,
        date: new Date("2026-01-10T00:00:00.000Z"),
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      tx({
        id: "far",
        accountId: "savings",
        amount: 5000,
        date: new Date("2026-01-12T00:00:00.000Z"),
      }),
      tx({
        id: "near",
        accountId: "savings",
        amount: 5000,
        date: new Date("2026-01-11T00:00:00.000Z"),
      }),
    ];
    expect(findTransferMatches(candidates, OPTIONS)).toEqual([
      { anchorId: "out", counterpartId: "near" },
    ]);
  });

  it("assigns same-day duplicates deterministically without double-using a candidate", () => {
    // Two identical $50 transfers out of checking on the same day, two
    // identical $50 deposits into savings the same day -- genuinely
    // ambiguous which paired with which, but every candidate must be used
    // at most once and the result must be the same on every run.
    const candidates = [
      tx({
        id: "out-1",
        accountId: "checking",
        amount: -5000,
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      tx({
        id: "out-2",
        accountId: "checking",
        amount: -5000,
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      tx({ id: "in-1", accountId: "savings", amount: 5000 }),
      tx({ id: "in-2", accountId: "savings", amount: 5000 }),
    ];
    const result = findTransferMatches(candidates, OPTIONS);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.counterpartId).sort()).toEqual(["in-1", "in-2"]);
    // Deterministic: running it again produces the exact same pairing.
    expect(findTransferMatches(candidates, OPTIONS)).toEqual(result);
  });

  it("never reuses a transaction across two pairs", () => {
    // One anchor, two otherwise-eligible counterparts -- only one pair
    // should come out, and the leftover candidate must not silently
    // attach to anything else.
    const candidates = [
      tx({
        id: "out",
        accountId: "checking",
        amount: -5000,
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      tx({ id: "in-1", accountId: "savings", amount: 5000 }),
      tx({ id: "in-2", accountId: "savings", amount: 5000 }),
    ];
    const result = findTransferMatches(candidates, OPTIONS);
    expect(result).toHaveLength(1);
    const usedIds = new Set(result.flatMap((p) => [p.anchorId, p.counterpartId]));
    expect(usedIds.size).toBe(2);
  });

  it("ignores a candidate with a zero amount", () => {
    const candidates = [
      tx({
        id: "out",
        accountId: "checking",
        amount: -5000,
        providerCategory: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      tx({ id: "zero", accountId: "savings", amount: 0 }),
    ];
    expect(findTransferMatches(candidates, OPTIONS)).toEqual([]);
  });

  it("returns no matches for an empty candidate list", () => {
    expect(findTransferMatches([], OPTIONS)).toEqual([]);
  });
});
