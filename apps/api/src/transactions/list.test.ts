import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import type { AccountDocument, TransactionDocument } from "@financial-os/db";
import { buildTransactionList } from "./list.js";

function transaction(overrides: Partial<TransactionDocument> = {}): TransactionDocument {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: "user-1",
    accountId: new mongoose.Types.ObjectId(),
    providerTransactionId: "txn-provider-1",
    date: new Date("2026-08-01T00:00:00.000Z"),
    amount: 4_250,
    isoCurrencyCode: "USD",
    merchantNameNormalized: "trader joes",
    description: "TRADER JOE'S #123",
    category: { tier: 1, value: "Groceries", status: "confirmed" },
    excludeFromCashFlow: false,
    pending: false,
    isRemoved: false,
    createdAt: new Date("2026-08-01"),
    updatedAt: new Date("2026-08-01"),
    ...overrides,
  };
}

function account(overrides: Partial<AccountDocument> = {}): AccountDocument {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: "user-1",
    connectionId: new mongoose.Types.ObjectId(),
    provider: "plaid",
    providerAccountId: "acct-provider-1",
    institutionName: "Chase",
    type: "depository",
    subtype: "checking",
    currentBalance: 10_000,
    isoCurrencyCode: "USD",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("buildTransactionList", () => {
  it("returns an empty list when there's nothing to show", () => {
    expect(buildTransactionList([], [])).toEqual([]);
  });

  it("joins a transaction to its account's institution and subtype", () => {
    const acct = account({ institutionName: "Amex", subtype: "credit card" });
    const txn = transaction({ accountId: acct._id });

    const [item] = buildTransactionList([txn], [acct]);

    expect(item?.account).toEqual({
      id: acct._id.toString(),
      institutionName: "Amex",
      subtype: "credit card",
    });
  });

  it("falls back to merchantNameNormalized when merchantName is absent", () => {
    const acct = account();
    const txn = transaction({
      accountId: acct._id,
      merchantName: undefined,
      merchantNameNormalized: "trader joes",
    });

    const [item] = buildTransactionList([txn], [acct]);

    expect(item?.merchantName).toBe("trader joes");
  });

  it("prefers the cleaned merchantName over the normalized key when both are present", () => {
    const acct = account();
    const txn = transaction({
      accountId: acct._id,
      merchantName: "Trader Joe's",
      merchantNameNormalized: "trader joes",
    });

    const [item] = buildTransactionList([txn], [acct]);

    expect(item?.merchantName).toBe("Trader Joe's");
  });

  it("CAT-13: a merchantNameOverride wins over both merchantName and merchantNameNormalized", () => {
    const acct = account();
    const txn = transaction({
      accountId: acct._id,
      merchantName: "Trader Joe's",
      merchantNameNormalized: "trader joes",
      merchantNameOverride: "Weekly groceries",
    });

    const [item] = buildTransactionList([txn], [acct]);

    expect(item?.merchantName).toBe("Weekly groceries");
  });

  it("falls back to a placeholder account when accountId matches nothing passed in", () => {
    const orphan = transaction({ accountId: new mongoose.Types.ObjectId() });

    const [item] = buildTransactionList([orphan], []);

    expect(item?.account.institutionName).toBe("Unknown account");
    expect(item?.account.subtype).toBe("");
  });

  it("preserves input order rather than re-sorting", () => {
    const acct = account();
    const older = transaction({
      accountId: acct._id,
      date: new Date("2026-07-01"),
      merchantNameNormalized: "older",
    });
    const newer = transaction({
      accountId: acct._id,
      date: new Date("2026-08-01"),
      merchantNameNormalized: "newer",
    });

    // Passed in an order a real date-desc query would never produce --
    // the function must not silently re-sort it back.
    const items = buildTransactionList([older, newer], [acct]);

    expect(items.map((i) => i.merchantName)).toEqual(["older", "newer"]);
  });

  it("passes through amount, currency, pending, and category value/status unchanged", () => {
    const acct = account();
    const txn = transaction({
      accountId: acct._id,
      amount: 1_299,
      isoCurrencyCode: "EUR",
      pending: true,
      category: { tier: 4, value: "Uncategorized", status: "needs_review" },
    });

    const [item] = buildTransactionList([txn], [acct]);

    expect(item).toMatchObject({
      amount: 1_299,
      isoCurrencyCode: "EUR",
      pending: true,
      category: { value: "Uncategorized", status: "needs_review" },
    });
  });
});
