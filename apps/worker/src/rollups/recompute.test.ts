import { describe, it, expect } from "vitest";
import {
  computeDailyBalanceSnapshot,
  computeMonthlyRollup,
  type RecomputeAccount,
  type RecomputeTransactionDelta,
} from "./recompute.js";

function account(overrides: Partial<RecomputeAccount> = {}): RecomputeAccount {
  return {
    id: "acct-1",
    type: "depository",
    currentBalance: 10_000,
    linkedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const DAY = new Date("2026-01-15T00:00:00.000Z");

describe("computeDailyBalanceSnapshot", () => {
  it("uses currentBalance as-is when nothing happened after the day", () => {
    const result = computeDailyBalanceSnapshot(DAY, [account()], []);
    expect(result.accounts).toEqual([{ accountId: "acct-1", balance: 10_000 }]);
    expect(result.assets).toBe(10_000);
    expect(result.liabilities).toBe(0);
    expect(result.netWorth).toBe(10_000);
  });

  it("adds back a later debit (positive amount) -- balance was higher before it left", () => {
    const deltas: RecomputeTransactionDelta[] = [{ accountId: "acct-1", amount: 5_000 }];
    const result = computeDailyBalanceSnapshot(DAY, [account()], deltas);
    // $100 currentBalance, plus $50 that left the account after `day`.
    expect(result.accounts[0]?.balance).toBe(15_000);
  });

  it("adds back a later credit (negative amount) -- balance was lower before it arrived", () => {
    const deltas: RecomputeTransactionDelta[] = [{ accountId: "acct-1", amount: -3_000 }];
    const result = computeDailyBalanceSnapshot(DAY, [account()], deltas);
    expect(result.accounts[0]?.balance).toBe(7_000);
  });

  it("sums multiple transactions for the same account", () => {
    const deltas: RecomputeTransactionDelta[] = [
      { accountId: "acct-1", amount: 5_000 },
      { accountId: "acct-1", amount: -2_000 },
      { accountId: "acct-1", amount: 1_000 },
    ];
    const result = computeDailyBalanceSnapshot(DAY, [account()], deltas);
    // 10_000 + 5_000 - 2_000 + 1_000
    expect(result.accounts[0]?.balance).toBe(14_000);
  });

  it("treats depository and investment accounts as assets", () => {
    const accounts = [
      account({ id: "checking", type: "depository", currentBalance: 5_000 }),
      account({ id: "brokerage", type: "investment", currentBalance: 20_000 }),
    ];
    const result = computeDailyBalanceSnapshot(DAY, accounts, []);
    expect(result.assets).toBe(25_000);
    expect(result.liabilities).toBe(0);
    expect(result.netWorth).toBe(25_000);
  });

  it("treats credit and loan accounts as liabilities, subtracted from net worth", () => {
    const accounts = [
      account({ id: "checking", type: "depository", currentBalance: 10_000 }),
      account({ id: "card", type: "credit", currentBalance: 3_000 }),
      account({ id: "mortgage", type: "loan", currentBalance: 200_000 }),
    ];
    const result = computeDailyBalanceSnapshot(DAY, accounts, []);
    expect(result.assets).toBe(10_000);
    expect(result.liabilities).toBe(203_000);
    expect(result.netWorth).toBe(10_000 - 203_000);
  });

  it("omits an account not yet linked as of this day -- the gap ANLY-11 renders", () => {
    const accounts = [
      account({ id: "old", linkedAt: new Date("2025-12-01") }),
      account({ id: "new", linkedAt: new Date("2026-02-01") }), // after DAY
    ];
    const result = computeDailyBalanceSnapshot(DAY, accounts, []);
    expect(result.accounts.map((a) => a.accountId)).toEqual(["old"]);
    expect(result.assets).toBe(10_000);
  });

  it("includes an account linked exactly on this day", () => {
    const accounts = [account({ id: "same-day", linkedAt: DAY })];
    const result = computeDailyBalanceSnapshot(DAY, accounts, []);
    expect(result.accounts.map((a) => a.accountId)).toEqual(["same-day"]);
  });

  it("ignores transaction deltas for an account excluded as not-yet-linked", () => {
    const accounts = [account({ id: "new", linkedAt: new Date("2026-02-01") })];
    const deltas: RecomputeTransactionDelta[] = [{ accountId: "new", amount: 500 }];
    const result = computeDailyBalanceSnapshot(DAY, accounts, deltas);
    expect(result.accounts).toEqual([]);
    expect(result.netWorth).toBe(0);
  });

  it("returns an empty, zeroed snapshot when there are no linked accounts yet", () => {
    const result = computeDailyBalanceSnapshot(DAY, [], []);
    expect(result).toEqual({ netWorth: 0, assets: 0, liabilities: 0, accounts: [] });
  });
});

describe("computeMonthlyRollup", () => {
  it("sums positive amounts (money leaving the account) as expenses", () => {
    const result = computeMonthlyRollup([{ amount: 2_000 }, { amount: 3_500 }]);
    expect(result.expenses).toBe(5_500);
    expect(result.income).toBe(0);
  });

  it("sums the magnitude of negative amounts (money arriving) as income", () => {
    const result = computeMonthlyRollup([{ amount: -100_000 }, { amount: -5_000 }]);
    expect(result.income).toBe(105_000);
    expect(result.expenses).toBe(0);
  });

  it("computes income and expenses independently from a mixed set", () => {
    const result = computeMonthlyRollup([
      { amount: -200_000 }, // paycheck
      { amount: 4_500 }, // groceries
      { amount: 1_200 }, // dinner
      { amount: -50 }, // refund
    ]);
    expect(result.income).toBe(200_050);
    expect(result.expenses).toBe(5_700);
  });

  it("a zero-amount transaction contributes to neither total", () => {
    const result = computeMonthlyRollup([{ amount: 0 }, { amount: 1_000 }]);
    expect(result.expenses).toBe(1_000);
    expect(result.income).toBe(0);
  });

  it("returns zeroed totals for an empty month", () => {
    expect(computeMonthlyRollup([])).toEqual({ income: 0, expenses: 0 });
  });
});
