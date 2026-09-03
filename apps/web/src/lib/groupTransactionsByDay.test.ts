import { describe, it, expect } from "vitest";
import type { TransactionListItem } from "../api/transactions";
import { groupTransactionsByDay } from "./groupTransactionsByDay";

function item(overrides: Partial<TransactionListItem> = {}): TransactionListItem {
  return {
    id: "txn-1",
    date: "2026-08-30T00:00:00.000Z",
    merchantName: "Trader Joe's",
    description: "TRADER JOE S #123",
    amount: 4_000,
    isoCurrencyCode: "USD",
    pending: false,
    category: { value: "Groceries", status: "confirmed" },
    account: { id: "acct-1", institutionName: "Chase", subtype: "checking" },
    isTransferCandidate: false,
    ...overrides,
  };
}

describe("groupTransactionsByDay", () => {
  it("returns an empty list for no transactions", () => {
    expect(groupTransactionsByDay([])).toEqual([]);
  });

  it("puts a single transaction into its own day group, sign-flipped to a signed delta", () => {
    const groups = groupTransactionsByDay([item({ amount: 4_000 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.date).toBe("2026-08-30T00:00:00.000Z");
    expect(groups[0]?.netTotal).toBe(-4_000);
    expect(groups[0]?.items).toHaveLength(1);
  });

  it("merges same-UTC-day transactions into one group and sums their sign-flipped amounts", () => {
    const groups = groupTransactionsByDay([
      item({ id: "a", date: "2026-08-30T08:00:00.000Z", amount: 4_000 }),
      item({ id: "b", date: "2026-08-30T20:00:00.000Z", amount: -6_276_93 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.netTotal).toBe(6_276_93 - 4_000);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("keeps distinct calendar days as separate groups, in first-seen order", () => {
    const groups = groupTransactionsByDay([
      item({ id: "newer", date: "2026-08-30T00:00:00.000Z" }),
      item({ id: "older", date: "2026-08-29T00:00:00.000Z" }),
    ]);
    expect(groups.map((g) => g.date)).toEqual([
      "2026-08-30T00:00:00.000Z",
      "2026-08-29T00:00:00.000Z",
    ]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["newer"]);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(["older"]);
  });

  it("groups by UTC calendar day regardless of time-of-day", () => {
    // 23:59 and 00:01 UTC on consecutive calendar dates -- close together
    // in wall-clock terms but must never be merged.
    const groups = groupTransactionsByDay([
      item({ id: "late", date: "2026-08-30T23:59:00.000Z" }),
      item({ id: "early", date: "2026-08-31T00:01:00.000Z" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("a net-zero day still forms its own group with netTotal 0", () => {
    const groups = groupTransactionsByDay([
      item({ id: "expense", amount: 5_000 }),
      item({ id: "income", amount: -5_000 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.netTotal).toBe(0);
  });
});
