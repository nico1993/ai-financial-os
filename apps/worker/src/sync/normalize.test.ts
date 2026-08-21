import { describe, it, expect } from "vitest";
import type { NormalizedTransaction } from "@financial-os/providers";
import type { TransactionDocument } from "@financial-os/db";
import {
  UNCATEGORIZED,
  normalizeMerchantName,
  toTransactionInput,
  utcDayStart,
  utcMonthStart,
} from "./normalize.js";

const ACCOUNT_ID = "account-object-id" as unknown as TransactionDocument["accountId"];

function tx(overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    providerTransactionId: "plaid-tx-1",
    accountProviderId: "plaid-acct-1",
    date: new Date("2024-03-15T00:00:00.000Z"),
    amount: 1234,
    isoCurrencyCode: "USD",
    description: "UBER   *TRIP 8QK2P",
    pending: false,
    ...overrides,
  };
}

describe("normalizeMerchantName", () => {
  it("prefers the provider's cleaned merchant name over the raw description", () => {
    expect(normalizeMerchantName({ merchantName: "Uber", description: "UBER *TRIP 8QK2P" })).toBe(
      "uber",
    );
  });

  it("falls back to the description when no merchant name is present", () => {
    expect(normalizeMerchantName({ description: "UBER *TRIP 8QK2P" })).toBe("uber trip 8qk2p");
  });

  it("falls back to the description when the merchant name is blank", () => {
    expect(normalizeMerchantName({ merchantName: "   ", description: "Trader Joe's" })).toBe(
      "trader joe s",
    );
  });

  it("collapses punctuation and repeated whitespace into single spaces", () => {
    expect(normalizeMerchantName({ description: "SQ *BLUE__BOTTLE   COFFEE" })).toBe(
      "sq blue bottle coffee",
    );
  });

  it("is stable across case and padding differences (the Tier 1 lookup key)", () => {
    const a = normalizeMerchantName({ description: "  NETFLIX.COM  " });
    const b = normalizeMerchantName({ description: "netflix.com" });
    expect(a).toBe(b);
  });
});

describe("utcDayStart / utcMonthStart", () => {
  it("truncates to UTC midnight without shifting the calendar date", () => {
    expect(utcDayStart(new Date("2024-03-15T23:45:00.000Z")).toISOString()).toBe(
      "2024-03-15T00:00:00.000Z",
    );
  });

  it("truncates to the first of the UTC month", () => {
    expect(utcMonthStart(new Date("2024-03-15T23:45:00.000Z")).toISOString()).toBe(
      "2024-03-01T00:00:00.000Z",
    );
  });

  it("keeps a Plaid calendar date on its own day (no timezone round-trip)", () => {
    // Plaid sends "2024-03-15", which parses as UTC midnight. Bucketing it
    // must not roll it back to the 14th (AGENTS.md date convention).
    expect(utcDayStart(new Date("2024-03-15")).toISOString()).toBe("2024-03-15T00:00:00.000Z");
  });
});

describe("toTransactionInput", () => {
  it("maps a normalized transaction onto the repository's input shape", () => {
    const input = toTransactionInput(tx({ merchantName: "Uber" }), {
      userId: "user-1",
      accountId: ACCOUNT_ID,
    });

    expect(input.userId).toBe("user-1");
    expect(input.accountId).toBe(ACCOUNT_ID);
    expect(input.providerTransactionId).toBe("plaid-tx-1");
    expect(input.description).toBe("UBER   *TRIP 8QK2P");
    expect(input.merchantName).toBe("Uber");
    expect(input.merchantNameNormalized).toBe("uber");
  });

  it("passes the amount through untouched (already integer cents)", () => {
    const input = toTransactionInput(tx({ amount: -4550 }), {
      userId: "user-1",
      accountId: ACCOUNT_ID,
    });
    expect(input.amount).toBe(-4550);
  });

  it("carries pendingTransactionId through for ING-9's pending/posted merge", () => {
    const input = toTransactionInput(tx({ pendingTransactionId: "plaid-tx-pending" }), {
      userId: "user-1",
      accountId: ACCOUNT_ID,
    });
    expect(input.pendingTransactionId).toBe("plaid-tx-pending");
  });

  it("assigns the interim uncategorized category so CAT-3 can claim it later", () => {
    const input = toTransactionInput(tx(), { userId: "user-1", accountId: ACCOUNT_ID });
    expect(input.category).toEqual(UNCATEGORIZED);
    expect(UNCATEGORIZED.status).toBe("needs_review");
  });

  it("does not set transfer fields — that is XFER-3's job, not the sync job's", () => {
    const input = toTransactionInput(tx(), { userId: "user-1", accountId: ACCOUNT_ID });
    expect(input.transferGroupId).toBeUndefined();
    expect(input.excludeFromCashFlow).toBeUndefined();
  });
});
