// syncConnection.ts — the provider-sync job's actual work, kept free of
// BullMQ, Fastify, and Mongoose (ARCHITECTURE.md §7.5). Everything it
// touches arrives through `deps`, so the pagination/cursor behaviour §2.2
// specifies is unit-testable against plain fakes.
import type {
  FinancialProvider,
  NormalizedTransaction,
  ProviderConnectionRef,
} from "@financial-os/providers";
import type {
  AccountDocument,
  ConnectionDocument,
  InsertRawPayloadInput,
  TransactionDocument,
  UpsertAccountInput,
  UpsertTransactionInput,
} from "@financial-os/db";
import { toTransactionInput, utcDayStart, utcMonthStart } from "./normalize.js";

/** Structural slices of the real repositories — narrow on purpose, so this
 * function states exactly what it touches and tests can supply fakes
 * without a database. */
export interface SyncConnectionDeps {
  provider: Pick<FinancialProvider, "syncTransactions" | "getAccounts">;
  connections: {
    findByIdWithAccessToken(connectionId: string): Promise<ConnectionDocument | null>;
    updateCursor(connectionId: string, cursor: string): Promise<void>;
  };
  accounts: {
    findByConnectionId(connectionId: string): Promise<AccountDocument[]>;
    upsertFromSync(input: UpsertAccountInput): Promise<AccountDocument>;
  };
  transactions: {
    upsertFromSync(input: UpsertTransactionInput): Promise<TransactionDocument>;
    findByProviderTransactionId(providerTransactionId: string): Promise<TransactionDocument | null>;
    markRemoved(providerTransactionId: string): Promise<void>;
  };
  rawPayloads: {
    insert(input: InsertRawPayloadInput): Promise<void>;
  };
}

export interface SyncConnectionResult {
  pagesProcessed: number;
  added: number;
  modified: number;
  removed: number;
  /** The cursor now persisted on the Connection. */
  finalCursor: string | null;
  /** UTC day/month buckets this run touched — the recompute signal
   * ADR-0008 asks every transaction-mutating job to emit. ANLY-2 turns
   * these into targeted `$merge` rollup recomputes. */
  touchedDayBuckets: Date[];
  touchedMonthBuckets: Date[];
  /** Provider transaction ids written this run, for CAT-4 to enqueue
   * categorization against once that queue exists. */
  syncedTransactionIds: string[];
  /** Transactions whose account could not be resolved even after a refresh
   * — skipped rather than dropped silently. Their raw payloads are still
   * stored, so they can be replayed once the account exists (§3.1). */
  skippedUnknownAccount: string[];
}

export class ConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Connection ${connectionId} not found`);
    this.name = "ConnectionNotFoundError";
  }
}

/**
 * Drains one connection's provider sync cursor to completion.
 *
 * The cursor is read from the database here rather than passed in by the
 * caller (§2.2): two jobs queued back-to-back for the same connection must
 * not race on a value captured at enqueue time.
 */
export async function syncConnection(
  connectionId: string,
  deps: SyncConnectionDeps,
): Promise<SyncConnectionResult> {
  const connection = await deps.connections.findByIdWithAccessToken(connectionId);
  if (!connection) throw new ConnectionNotFoundError(connectionId);

  const userId = connection.userId;
  const connectionObjectId = connection._id;
  const ref: ProviderConnectionRef = {
    providerItemId: connection.providerItemId,
    accessToken: connection.accessToken,
  };

  let accountIdsByProviderId = await loadAccountMap(deps, connectionId);
  let refreshedAccounts = false;

  const dayBuckets = new Map<string, Date>();
  const monthBuckets = new Map<string, Date>();
  const syncedTransactionIds: string[] = [];
  const skippedUnknownAccount: string[] = [];

  let cursor: string | null = connection.cursor ?? null;
  let pagesProcessed = 0;
  let added = 0;
  let modified = 0;
  let removed = 0;
  let hasMore = true;

  function recordBucket(date: Date): void {
    const day = utcDayStart(date);
    const month = utcMonthStart(date);
    dayBuckets.set(day.toISOString(), day);
    monthBuckets.set(month.toISOString(), month);
  }

  async function applyUpsert(tx: NormalizedTransaction): Promise<void> {
    // Raw first, always: whatever the bank sent is preserved even if the
    // normalization below rejects it (§3.1's replay-ability guarantee).
    await deps.rawPayloads.insert({
      userId,
      source: "plaid",
      type: "transaction",
      providerId: tx.providerTransactionId,
      payload: tx,
    });

    let accountId = accountIdsByProviderId.get(tx.accountProviderId);

    // A new account added to an existing Item can appear in transactions
    // before anything re-read the account list. Refresh once per run, not
    // once per orphaned transaction.
    if (!accountId && !refreshedAccounts) {
      refreshedAccounts = true;
      await refreshAccounts(deps, { userId, connectionId: connectionObjectId }, ref);
      accountIdsByProviderId = await loadAccountMap(deps, connectionId);
      accountId = accountIdsByProviderId.get(tx.accountProviderId);
    }

    if (!accountId) {
      skippedUnknownAccount.push(tx.providerTransactionId);
      return;
    }

    await deps.transactions.upsertFromSync(toTransactionInput(tx, { userId, accountId }));
    recordBucket(tx.date);
    syncedTransactionIds.push(tx.providerTransactionId);
  }

  while (hasMore) {
    const pageResult = await deps.provider.syncTransactions(ref, cursor);

    for (const tx of pageResult.added) {
      await applyUpsert(tx);
      added += 1;
    }
    for (const tx of pageResult.modified) {
      await applyUpsert(tx);
      modified += 1;
    }

    for (const entry of pageResult.removed) {
      // Read the date before soft-deleting: the rollup bucket that already
      // counted this transaction is exactly the one needing recompute
      // (ADR-0008, and the soft-delete propagation case in §6).
      const existing = await deps.transactions.findByProviderTransactionId(
        entry.providerTransactionId,
      );
      if (existing) recordBucket(existing.date);
      await deps.transactions.markRemoved(entry.providerTransactionId);
      removed += 1;
    }

    // Persisted per page, not once at the end (§2.2): a crash on page 4
    // resumes from page 3's cursor instead of replaying the whole drain.
    await deps.connections.updateCursor(connectionId, pageResult.nextCursor);
    cursor = pageResult.nextCursor;
    pagesProcessed += 1;
    hasMore = pageResult.hasMore;
  }

  return {
    pagesProcessed,
    added,
    modified,
    removed,
    finalCursor: cursor,
    touchedDayBuckets: [...dayBuckets.values()],
    touchedMonthBuckets: [...monthBuckets.values()],
    syncedTransactionIds,
    skippedUnknownAccount,
  };
}

async function loadAccountMap(
  deps: SyncConnectionDeps,
  connectionId: string,
): Promise<Map<string, TransactionDocument["accountId"]>> {
  const accounts = await deps.accounts.findByConnectionId(connectionId);
  return new Map(accounts.map((account) => [account.providerAccountId, account._id]));
}

async function refreshAccounts(
  deps: SyncConnectionDeps,
  owner: { userId: string; connectionId: AccountDocument["connectionId"] },
  ref: ProviderConnectionRef,
): Promise<void> {
  const providerAccounts = await deps.provider.getAccounts(ref);
  for (const account of providerAccounts) {
    await deps.accounts.upsertFromSync({
      userId: owner.userId,
      connectionId: owner.connectionId,
      provider: "plaid",
      providerAccountId: account.providerAccountId,
      institutionName: account.institutionName,
      type: account.type,
      subtype: account.subtype,
      officialName: account.officialName,
      currentBalance: account.currentBalance,
      availableBalance: account.availableBalance,
      isoCurrencyCode: account.isoCurrencyCode,
    });
  }
}
