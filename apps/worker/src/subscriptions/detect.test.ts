import { describe, it, expect } from "vitest";
import {
  detectSubscriptions,
  DEFAULT_SUBSCRIPTION_DETECTION_OPTIONS,
  type SubscriptionCandidateTransaction,
} from "./detect.js";

function tx(
  overrides: Partial<SubscriptionCandidateTransaction> = {},
): SubscriptionCandidateTransaction {
  return {
    id: "tx-1",
    merchantNameNormalized: "netflix",
    merchantName: "Netflix",
    amount: 1_599,
    date: new Date("2026-01-01"),
    ...overrides,
  };
}

function monthlySeries(
  merchant: string,
  amounts: number[],
  startDate: string,
  intervalDays = 30,
): SubscriptionCandidateTransaction[] {
  return amounts.map((amount, i) => {
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + i * intervalDays);
    return tx({
      id: `${merchant}-${i}`,
      merchantNameNormalized: merchant,
      merchantName: merchant,
      amount,
      date,
    });
  });
}

describe("detectSubscriptions", () => {
  it("detects a merchant billing monthly at a steady amount", () => {
    const txns = monthlySeries("netflix", [1_599, 1_599, 1_599, 1_599], "2026-01-01", 30);
    const results = detectSubscriptions(txns);
    expect(results).toHaveLength(1);
    expect(results[0]?.merchantNameNormalized).toBe("netflix");
    expect(results[0]?.frequency).toBe("monthly");
    expect(results[0]?.transactionIds).toEqual([
      "netflix-0",
      "netflix-1",
      "netflix-2",
      "netflix-3",
    ]);
  });

  it("detects a merchant billing annually", () => {
    const txns = monthlySeries("amazon-prime", [13_900, 13_900, 13_900], "2024-03-01", 365);
    const results = detectSubscriptions(txns);
    expect(results).toHaveLength(1);
    expect(results[0]?.frequency).toBe("annual");
  });

  it("requires at least the configured minimum occurrences", () => {
    const txns = monthlySeries("netflix", [1_599, 1_599], "2026-01-01", 30); // only 2
    expect(detectSubscriptions(txns)).toEqual([]);
  });

  it("rejects a merchant whose amounts vary too widely to be a subscription", () => {
    const txns = monthlySeries("amazon", [2_000, 8_000, 15_000, 500], "2026-01-01", 30);
    expect(detectSubscriptions(txns)).toEqual([]);
  });

  it("rejects a merchant whose interval doesn't cluster near 30 or 365 days", () => {
    // Weekly-ish (~7 days) -- not a Phase 1 match, even though it's
    // perfectly regular and same-amount.
    const txns = monthlySeries("coffee-shop", [500, 500, 500, 500], "2026-01-01", 7);
    expect(detectSubscriptions(txns)).toEqual([]);
  });

  it("rejects a merchant whose intervals are too scattered even if the average lands near 30", () => {
    const base = new Date("2026-01-01");
    const txns: SubscriptionCandidateTransaction[] = [
      tx({ id: "t0", merchantNameNormalized: "sketchy", amount: 1_000, date: base }),
      tx({
        id: "t1",
        merchantNameNormalized: "sketchy",
        amount: 1_000,
        date: new Date(base.getTime() + 5 * 24 * 60 * 60 * 1000), // +5 days
      }),
      tx({
        id: "t2",
        merchantNameNormalized: "sketchy",
        amount: 1_000,
        date: new Date(base.getTime() + 65 * 24 * 60 * 60 * 1000), // +60 more days -- avg is ~32.5 but wildly scattered
      }),
    ];
    expect(detectSubscriptions(txns)).toEqual([]);
  });

  it("ignores non-positive amounts (income/refunds are never subscriptions)", () => {
    const txns = monthlySeries("netflix", [1_599, 1_599, 1_599], "2026-01-01", 30);
    txns.push(
      tx({
        id: "refund",
        merchantNameNormalized: "netflix",
        amount: -1_599,
        date: new Date("2026-04-15"),
      }),
    );
    const results = detectSubscriptions(txns);
    expect(results).toHaveLength(1);
    expect(results[0]?.transactionIds).not.toContain("refund");
  });

  it("evaluates each merchant independently and only returns qualifying ones", () => {
    const netflix = monthlySeries("netflix", [1_599, 1_599, 1_599], "2026-01-01", 30);
    const oneOff = [tx({ id: "coffee-1", merchantNameNormalized: "coffee-shop", amount: 450 })];
    const results = detectSubscriptions([...netflix, ...oneOff]);
    expect(results.map((r) => r.merchantNameNormalized)).toEqual(["netflix"]);
  });

  it("reports the most recent transaction's amount/date as the subscription's current snapshot", () => {
    const txns = monthlySeries("netflix", [1_599, 1_599, 1_699], "2026-01-01", 30); // price bump within tolerance
    const results = detectSubscriptions(txns);
    expect(results[0]?.amount).toBe(1_699);
    expect(results[0]?.lastTransactionDate).toEqual(new Date("2026-03-02"));
  });

  it("projects nextExpectedDate as lastTransactionDate plus the detected interval", () => {
    const txns = monthlySeries("netflix", [1_599, 1_599, 1_599], "2026-01-01", 30);
    const results = detectSubscriptions(txns);
    const last = txns[txns.length - 1]!.date;
    const expected = new Date(
      last.getTime() + (results[0]?.intervalDays ?? 0) * 24 * 60 * 60 * 1000,
    );
    expect(results[0]?.nextExpectedDate).toEqual(expected);
  });

  it("uses the default options when none are given", () => {
    expect(DEFAULT_SUBSCRIPTION_DETECTION_OPTIONS.minOccurrences).toBe(3);
  });
});
