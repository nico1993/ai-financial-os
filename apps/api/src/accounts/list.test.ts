import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import type { AccountDocument, ConnectionDocument } from "@financial-os/db";
import { buildAccountList } from "./list.js";

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

function connection(overrides: Partial<ConnectionDocument> = {}): ConnectionDocument {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: "user-1",
    provider: "plaid",
    providerItemId: "item-1",
    accessToken: "access-token-1",
    institutionName: "Chase",
    status: "active",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("buildAccountList", () => {
  it("returns an empty list for a user with nothing linked", () => {
    expect(buildAccountList([], [])).toEqual([]);
  });

  it("joins an account to its connection's live status", () => {
    const conn = connection({ status: "login_required" });
    const acct = account({ connectionId: conn._id });

    const [item] = buildAccountList([acct], [conn]);

    expect(item).toEqual({
      id: acct._id.toString(),
      connectionId: conn._id.toString(),
      connectionStatus: "login_required",
      institutionName: "Chase",
      type: "depository",
      subtype: "checking",
      officialName: undefined,
      currentBalance: 10_000,
      availableBalance: undefined,
      isoCurrencyCode: "USD",
    });
  });

  it("resolves each account against its own connection when a user has several", () => {
    const chase = connection({ institutionName: "Chase", status: "active" });
    const amex = connection({ institutionName: "Amex", status: "error" });
    const checking = account({
      connectionId: chase._id,
      institutionName: "Chase",
      subtype: "checking",
    });
    const credit = account({
      connectionId: amex._id,
      institutionName: "Amex",
      type: "credit",
      subtype: "credit card",
      currentBalance: 5_000,
    });

    const items = buildAccountList([checking, credit], [chase, amex]);

    expect(items.find((i) => i.id === checking._id.toString())?.connectionStatus).toBe("active");
    expect(items.find((i) => i.id === credit._id.toString())?.connectionStatus).toBe("error");
  });

  it('falls back to "error" when an account\'s connectionId matches nothing passed in', () => {
    const orphan = account({ connectionId: new mongoose.Types.ObjectId() });

    const [item] = buildAccountList([orphan], []);

    expect(item?.connectionStatus).toBe("error");
  });

  it("sorts by institution name first", () => {
    const zeta = connection({ institutionName: "Zeta Bank" });
    const alpha = connection({ institutionName: "Alpha Bank" });
    const zetaAcct = account({ connectionId: zeta._id, institutionName: "Zeta Bank" });
    const alphaAcct = account({ connectionId: alpha._id, institutionName: "Alpha Bank" });

    const items = buildAccountList([zetaAcct, alphaAcct], [zeta, alpha]);

    expect(items.map((i) => i.institutionName)).toEqual(["Alpha Bank", "Zeta Bank"]);
  });

  it("breaks a same-institution tie by subtype", () => {
    const conn = connection();
    const savings = account({ connectionId: conn._id, subtype: "savings" });
    const checking = account({ connectionId: conn._id, subtype: "checking" });

    const items = buildAccountList([savings, checking], [conn]);

    expect(items.map((i) => i.subtype)).toEqual(["checking", "savings"]);
  });

  it("passes through optional officialName/availableBalance when present", () => {
    const conn = connection();
    const acct = account({
      connectionId: conn._id,
      officialName: "Chase Total Checking",
      availableBalance: 9_500,
    });

    const [item] = buildAccountList([acct], [conn]);

    expect(item?.officialName).toBe("Chase Total Checking");
    expect(item?.availableBalance).toBe(9_500);
  });
});
