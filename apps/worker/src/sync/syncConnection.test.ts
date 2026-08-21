import { describe, it, expect } from "vitest";
import type {
  NormalizedAccount,
  NormalizedTransaction,
  SyncTransactionsResult,
} from "@financial-os/providers";
import type { AccountDocument, ConnectionDocument, TransactionDocument } from "@financial-os/db";
import { syncConnection, type SyncConnectionDeps } from "./syncConnection.js";

const CONNECTION_ID = "conn-1";

function objectId(value: string): TransactionDocument["accountId"] {
  return value as unknown as TransactionDocument["accountId"];
}

function connectionDoc(overrides: Partial<ConnectionDocument> = {}): ConnectionDocument {
  return {
    _id: objectId(CONNECTION_ID),
    userId: "user-1",
    provider: "plaid",
    providerItemId: "item-1",
    accessToken: "access-sandbox-abc",
    institutionName: "Chase",
    status: "active",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  } as ConnectionDocument;
}

function accountDoc(providerAccountId: string, id = `acct-${providerAccountId}`): AccountDocument {
  return {
    _id: objectId(id),
    userId: "user-1",
    connectionId: objectId(CONNECTION_ID),
    provider: "plaid",
    providerAccountId,
    institutionName: "Chase",
    type: "depository",
    subtype: "checking",
    currentBalance: 100_00,
    isoCurrencyCode: "USD",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as AccountDocument;
}

function tx(overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    providerTransactionId: "tx-1",
    accountProviderId: "plaid-acct-1",
    date: new Date("2024-03-15T00:00:00.000Z"),
    amount: 1234,
    isoCurrencyCode: "USD",
    description: "COFFEE",
    pending: false,
    ...overrides,
  };
}

function page(overrides: Partial<SyncTransactionsResult> = {}): SyncTransactionsResult {
  return {
    added: [],
    modified: [],
    removed: [],
    nextCursor: "cursor-end",
    hasMore: false,
    ...overrides,
  };
}

interface Harness {
  deps: SyncConnectionDeps;
  calls: {
    syncCursors: (string | null)[];
    updatedCursors: string[];
    upserted: string[];
    removed: string[];
    rawPayloads: string[];
    getAccountsCalls: number;
    accountUpserts: string[];
  };
}

function harness(options: {
  pages?: SyncTransactionsResult[];
  connection?: ConnectionDocument | null;
  accounts?: AccountDocument[];
  refreshedAccounts?: NormalizedAccount[];
  existingTransactions?: Record<string, TransactionDocument>;
  syncImpl?: (cursor: string | null, index: number) => Promise<SyncTransactionsResult>;
}): Harness {
  const calls: Harness["calls"] = {
    syncCursors: [],
    updatedCursors: [],
    upserted: [],
    removed: [],
    rawPayloads: [],
    getAccountsCalls: 0,
    accountUpserts: [],
  };

  const pages = options.pages ?? [page()];
  let pageIndex = 0;
  let accounts = options.accounts ?? [accountDoc("plaid-acct-1")];

  const deps: SyncConnectionDeps = {
    provider: {
      async syncTransactions(_ref, cursor) {
        calls.syncCursors.push(cursor);
        const index = pageIndex++;
        if (options.syncImpl) return options.syncImpl(cursor, index);
        const next = pages[index];
        if (!next) throw new Error(`fake provider ran out of pages at index ${index}`);
        return next;
      },
      async getAccounts() {
        calls.getAccountsCalls += 1;
        return options.refreshedAccounts ?? [];
      },
    },
    connections: {
      async findByIdWithAccessToken() {
        return options.connection === undefined ? connectionDoc() : options.connection;
      },
      async updateCursor(_id, cursor) {
        calls.updatedCursors.push(cursor);
      },
    },
    accounts: {
      async findByConnectionId() {
        return accounts;
      },
      async upsertFromSync(input) {
        calls.accountUpserts.push(input.providerAccountId);
        const created = accountDoc(input.providerAccountId);
        accounts = [...accounts, created];
        return created;
      },
    },
    transactions: {
      async upsertFromSync(input) {
        calls.upserted.push(input.providerTransactionId);
        return {} as TransactionDocument;
      },
      async findByProviderTransactionId(id) {
        return options.existingTransactions?.[id] ?? null;
      },
      async markRemoved(id) {
        calls.removed.push(id);
      },
    },
    rawPayloads: {
      async insert(input) {
        calls.rawPayloads.push(input.providerId);
      },
    },
  };

  return { deps, calls };
}

describe("syncConnection — cursor pagination (ARCHITECTURE.md §2.2)", () => {
  it("throws when the connection does not exist", async () => {
    const { deps } = harness({ connection: null });
    await expect(syncConnection(CONNECTION_ID, deps)).rejects.toThrow(/conn-1/);
  });

  it("sends a null cursor on the very first sync", async () => {
    const { deps, calls } = harness({});
    await syncConnection(CONNECTION_ID, deps);
    expect(calls.syncCursors).toEqual([null]);
  });

  it("resumes from the cursor stored on the connection", async () => {
    const { deps, calls } = harness({ connection: connectionDoc({ cursor: "cursor-stored" }) });
    await syncConnection(CONNECTION_ID, deps);
    expect(calls.syncCursors).toEqual(["cursor-stored"]);
  });

  it("drains every page while hasMore is true, feeding each nextCursor forward", async () => {
    const { deps, calls } = harness({
      pages: [
        page({ nextCursor: "cursor-1", hasMore: true }),
        page({ nextCursor: "cursor-2", hasMore: true }),
        page({ nextCursor: "cursor-3", hasMore: false }),
      ],
    });

    const result = await syncConnection(CONNECTION_ID, deps);

    expect(calls.syncCursors).toEqual([null, "cursor-1", "cursor-2"]);
    expect(result.pagesProcessed).toBe(3);
    expect(result.finalCursor).toBe("cursor-3");
  });

  it("persists the cursor after EVERY page, not just at the end", async () => {
    const { deps, calls } = harness({
      pages: [
        page({ nextCursor: "cursor-1", hasMore: true }),
        page({ nextCursor: "cursor-2", hasMore: true }),
        page({ nextCursor: "cursor-3", hasMore: false }),
      ],
    });

    await syncConnection(CONNECTION_ID, deps);

    expect(calls.updatedCursors).toEqual(["cursor-1", "cursor-2", "cursor-3"]);
  });

  it("leaves the cursor at the last fully-processed page when a later page throws", async () => {
    // The crash-mid-pagination case §2.2 calls out: the next run must resume
    // from page 1's cursor rather than replaying the whole drain.
    const { deps, calls } = harness({
      syncImpl: async (_cursor, index) => {
        if (index === 0) return page({ nextCursor: "cursor-1", hasMore: true });
        throw new Error("plaid exploded on page 2");
      },
    });

    await expect(syncConnection(CONNECTION_ID, deps)).rejects.toThrow(/plaid exploded/);
    expect(calls.updatedCursors).toEqual(["cursor-1"]);
  });
});

describe("syncConnection — applying a page", () => {
  it("upserts added and modified transactions", async () => {
    const { deps, calls } = harness({
      pages: [
        page({
          added: [tx({ providerTransactionId: "tx-added" })],
          modified: [tx({ providerTransactionId: "tx-modified" })],
        }),
      ],
    });

    const result = await syncConnection(CONNECTION_ID, deps);

    expect(calls.upserted).toEqual(["tx-added", "tx-modified"]);
    expect(result.added).toBe(1);
    expect(result.modified).toBe(1);
  });

  it("soft-removes removed transactions", async () => {
    const { deps, calls } = harness({
      pages: [page({ removed: [{ providerTransactionId: "tx-gone" }] })],
    });

    const result = await syncConnection(CONNECTION_ID, deps);

    expect(calls.removed).toEqual(["tx-gone"]);
    expect(result.removed).toBe(1);
  });

  it("stores a raw payload for every transaction the provider sent (§3.1)", async () => {
    const { deps, calls } = harness({
      pages: [
        page({
          added: [tx({ providerTransactionId: "tx-a" })],
          modified: [tx({ providerTransactionId: "tx-b" })],
        }),
      ],
    });

    await syncConnection(CONNECTION_ID, deps);

    expect(calls.rawPayloads).toEqual(["tx-a", "tx-b"]);
  });
});

describe("syncConnection — touched date buckets (ADR-0008)", () => {
  it("collects the UTC day and month bucket of each upserted transaction", async () => {
    const { deps } = harness({
      pages: [
        page({
          added: [
            tx({ providerTransactionId: "tx-a", date: new Date("2024-03-15T00:00:00.000Z") }),
            tx({ providerTransactionId: "tx-b", date: new Date("2024-03-15T00:00:00.000Z") }),
            tx({ providerTransactionId: "tx-c", date: new Date("2024-04-02T00:00:00.000Z") }),
          ],
        }),
      ],
    });

    const result = await syncConnection(CONNECTION_ID, deps);

    expect(result.touchedDayBuckets.map((d) => d.toISOString())).toEqual([
      "2024-03-15T00:00:00.000Z",
      "2024-04-02T00:00:00.000Z",
    ]);
    expect(result.touchedMonthBuckets.map((d) => d.toISOString())).toEqual([
      "2024-03-01T00:00:00.000Z",
      "2024-04-01T00:00:00.000Z",
    ]);
  });

  it("collects the bucket of a REMOVED transaction from its stored date", async () => {
    // Without this the rollup that already counted the removed transaction
    // never gets recomputed — the soft-delete propagation case in §6.
    const { deps } = harness({
      pages: [page({ removed: [{ providerTransactionId: "tx-gone" }] })],
      existingTransactions: {
        "tx-gone": { date: new Date("2024-01-09T00:00:00.000Z") } as TransactionDocument,
      },
    });

    const result = await syncConnection(CONNECTION_ID, deps);

    expect(result.touchedDayBuckets.map((d) => d.toISOString())).toEqual([
      "2024-01-09T00:00:00.000Z",
    ]);
  });

  it("does not fail when a removed transaction was never stored locally", async () => {
    const { deps, calls } = harness({
      pages: [page({ removed: [{ providerTransactionId: "tx-unknown" }] })],
    });

    const result = await syncConnection(CONNECTION_ID, deps);

    expect(calls.removed).toEqual(["tx-unknown"]);
    expect(result.touchedDayBuckets).toEqual([]);
  });
});

describe("syncConnection — account resolution", () => {
  it("maps a transaction's provider account id onto the internal account id", async () => {
    const { deps, calls } = harness({
      accounts: [accountDoc("plaid-acct-1", "acct-internal-1")],
      pages: [page({ added: [tx({ accountProviderId: "plaid-acct-1" })] })],
    });

    await syncConnection(CONNECTION_ID, deps);

    expect(calls.upserted).toEqual(["tx-1"]);
  });

  it("refreshes the account list once when a transaction names an unknown account", async () => {
    // A new account added to an existing Item shows up in transactions
    // before anything has re-fetched /accounts/get.
    const { deps, calls } = harness({
      accounts: [accountDoc("plaid-acct-1")],
      pages: [
        page({
          added: [
            tx({ providerTransactionId: "tx-new-acct", accountProviderId: "plaid-acct-2" }),
            tx({ providerTransactionId: "tx-new-acct-2", accountProviderId: "plaid-acct-2" }),
          ],
        }),
      ],
      refreshedAccounts: [
        {
          providerAccountId: "plaid-acct-2",
          institutionName: "Chase",
          type: "credit",
          subtype: "credit card",
          currentBalance: -5000,
          isoCurrencyCode: "USD",
        },
      ],
    });

    const result = await syncConnection(CONNECTION_ID, deps);

    expect(calls.getAccountsCalls).toBe(1);
    expect(calls.accountUpserts).toEqual(["plaid-acct-2"]);
    expect(calls.upserted).toEqual(["tx-new-acct", "tx-new-acct-2"]);
    expect(result.skippedUnknownAccount).toEqual([]);
  });

  it("skips and reports a transaction whose account is still unknown after a refresh", async () => {
    const { deps, calls } = harness({
      accounts: [accountDoc("plaid-acct-1")],
      pages: [
        page({
          added: [
            tx({ providerTransactionId: "tx-ok", accountProviderId: "plaid-acct-1" }),
            tx({ providerTransactionId: "tx-orphan", accountProviderId: "plaid-acct-ghost" }),
          ],
        }),
      ],
      refreshedAccounts: [],
    });

    const result = await syncConnection(CONNECTION_ID, deps);

    // The orphan is skipped, but the rest of the page still lands and the
    // run still completes — one bad account must not stall ingestion.
    expect(calls.upserted).toEqual(["tx-ok"]);
    expect(result.skippedUnknownAccount).toEqual(["tx-orphan"]);
    // Its raw payload is still stored, so it can be replayed later (§3.1).
    expect(calls.rawPayloads).toContain("tx-orphan");
  });
});
