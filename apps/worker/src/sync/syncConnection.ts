// syncConnection.ts — the provider-sync job's actual work, kept free of
// BullMQ, Fastify, and Mongoose (ARCHITECTURE.md §7.5). Everything it
// touches arrives through `deps`, so the pagination/cursor behaviour §2.2
// specifies is unit-testable against plain fakes.
import {
  ProviderCursorInvalidError,
  ProviderSyncMutationError,
  type FinancialProvider,
  type NormalizedTransaction,
  type ProviderConnectionRef,
} from "@financial-os/providers";
import type {
  AccountDocument,
  ConnectionDocument,
  CorrectedMerchantRow,
  InsertRawPayloadInput,
  MerchantRuleDocument,
  TransactionDocument,
  UpsertAccountInput,
  UpsertTransactionInput,
} from "@financial-os/db";
import { isUncategorized, toTransactionInput, utcDayStart, utcMonthStart } from "./normalize.js";
import { buildTier1Index, resolveTier1 } from "../categorize/tier1.js";
import { resolveTier2, type Tier2RegexRule } from "../categorize/tier2.js";

/** Structural slices of the real repositories — narrow on purpose, so this
 * function states exactly what it touches and tests can supply fakes
 * without a database. */
export interface SyncConnectionDeps {
  provider: Pick<FinancialProvider, "syncTransactions" | "getAccounts">;
  connections: {
    findByIdWithAccessToken(connectionId: string): Promise<ConnectionDocument | null>;
    updateCursor(connectionId: string, cursor: string): Promise<void>;
    resetCursor(connectionId: string): Promise<void>;
  };
  accounts: {
    findByConnectionId(connectionId: string): Promise<AccountDocument[]>;
    upsertFromSync(input: UpsertAccountInput): Promise<AccountDocument>;
  };
  transactions: {
    upsertFromSync(input: UpsertTransactionInput): Promise<TransactionDocument>;
    findByProviderTransactionId(providerTransactionId: string): Promise<TransactionDocument | null>;
    markRemoved(providerTransactionId: string): Promise<void>;
    updateCategory(transactionId: string, category: TransactionDocument["category"]): Promise<void>;
    /** CAT-3's Tier 2 fuzzy-match pool (section 2.3). */
    findCorrectedMerchants(userId: string): Promise<CorrectedMerchantRow[]>;
  };
  rawPayloads: {
    insert(input: InsertRawPayloadInput): Promise<void>;
  };
  /** CAT-3: a user's Tier 1/2 rules, loaded once per sync run. Full
   * MerchantRuleDocuments in, narrowed to what the pure resolvers in
   * ../categorize/ actually need right here -- that mapping is this
   * module's job, not the repository's (packages/db has no business
   * knowing a pure function's input shape). */
  merchantRules: {
    findExactByUser(userId: string): Promise<MerchantRuleDocument[]>;
    findRegexByUser(userId: string): Promise<MerchantRuleDocument[]>;
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
  /** Pending transactions superseded by a posted counterpart this run
   * (ING-9). */
  pendingSuperseded: string[];
  /** How many times the drain had to restart because the provider
   * reported the data moved underneath it (ING-11). Non-zero is worth
   * noticing; persistently non-zero means something upstream is churning. */
  drainRestarts: number;
  /** True if a stale cursor forced a full resync from empty (ING-11). */
  cursorWasReset: boolean;
  /** Newly categorized this run by Tier 1 (exact match) / Tier 2
   * (regex/fuzzy) -- CAT-3. Whatever neither resolves stays
   * Uncategorized/needs_review, ready for CAT-4's LLM pass. */
  categorizedTier1: number;
  categorizedTier2: number;
}

export class ConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Connection ${connectionId} not found`);
    this.name = "ConnectionNotFoundError";
  }
}

/** A provider stuck reporting mid-pagination mutations must not spin the
 * worker forever; after this many restarts the job fails and BullMQ's
 * backoff takes over. */
const MAX_DRAIN_ATTEMPTS = 3;

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

  // Account lookups are a cache, deliberately shared across drain
  // attempts: a restart shouldn't re-fetch the account list.
  let accountIdsByProviderId = await loadAccountMap(deps, connectionId);
  let refreshedAccounts = false;

  // CAT-3: Tier 1/2 rules loaded once per run, not once per transaction --
  // same reasoning as the account cache above. A rule added mid-run by
  // CAT-6's write-back loop (unlikely for a single-user app mid-sync) is
  // simply picked up on the next sync.
  const [exactRules, regexRules, correctedMerchants] = await Promise.all([
    deps.merchantRules.findExactByUser(userId),
    deps.merchantRules.findRegexByUser(userId),
    deps.transactions.findCorrectedMerchants(userId),
  ]);
  const tier1Index = buildTier1Index(
    exactRules.map((rule) => ({ pattern: rule.pattern, category: rule.category })),
  );
  const tier2RegexRules: Tier2RegexRule[] = regexRules.map((rule) => ({
    pattern: rule.pattern,
    category: rule.category,
    priority: rule.priority,
  }));

  /** One full pagination pass. Its accumulators are local so a restart
   * (ING-11) reports what the successful pass actually did, rather than
   * summing in the work of an abandoned one. */
  async function drain(
    startCursor: string | null,
  ): Promise<Omit<SyncConnectionResult, "drainRestarts" | "cursorWasReset">> {
    const dayBuckets = new Map<string, Date>();
    const monthBuckets = new Map<string, Date>();
    const syncedTransactionIds: string[] = [];
    const skippedUnknownAccount: string[] = [];
    const pendingSuperseded: string[] = [];

    let cursor: string | null = startCursor;
    let pagesProcessed = 0;
    let added = 0;
    let modified = 0;
    let removed = 0;
    let categorizedTier1 = 0;
    let categorizedTier2 = 0;
    let hasMore = true;

    function recordBucket(date: Date): void {
      const day = utcDayStart(date);
      const month = utcMonthStart(date);
      dayBuckets.set(day.toISOString(), day);
      monthBuckets.set(month.toISOString(), month);
    }

    /** Pending→posted reconciliation (ING-9, §6). Plaid posts a settled
     * transaction under a NEW id, pointing back at the pending one via
     * pending_transaction_id. Leaving both live is, per §6, the single
     * most common source of double-counted spending in Plaid
     * integrations. */
    async function supersedePending(
      tx: NormalizedTransaction,
      postedId: TransactionDocument["_id"],
    ): Promise<void> {
      if (!tx.pendingTransactionId) return;

      const pending = await deps.transactions.findByProviderTransactionId(tx.pendingTransactionId);
      if (!pending || pending.isRemoved) return;

      // Carry a real category across. The posted row is a different
      // document, so without this every Tier 1/2/3 result — and worse,
      // every manual Tier 4 correction the user made while it was
      // pending — is silently discarded the moment it settles.
      if (pending.category && !isUncategorized(pending.category)) {
        await deps.transactions.updateCategory(postedId.toString(), pending.category);
      }

      // The pending row may sit in an earlier bucket than the posted one
      // (authorized Friday, settles Monday), and that bucket already
      // counted it — so it needs recomputing too.
      recordBucket(pending.date);
      await deps.transactions.markRemoved(tx.pendingTransactionId);
      pendingSuperseded.push(tx.pendingTransactionId);
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
        // Note this returns BEFORE supersedePending: the posted row never
        // landed, so removing its pending counterpart would delete the
        // only record of that spend we still have.
        skippedUnknownAccount.push(tx.providerTransactionId);
        return;
      }

      const input = toTransactionInput(tx, { userId, accountId });
      const posted = await deps.transactions.upsertFromSync(input);
      recordBucket(tx.date);
      syncedTransactionIds.push(tx.providerTransactionId);

      // CAT-3: Tier 1 then Tier 2, inline, no queue overhead (section 2.3).
      // Gated on isUncategorized() so a Plaid `modified` event never
      // re-guesses over a category Tier 3/4 (or a manual correction) has
      // already set -- the same $setOnInsert protection ADR-0020 gives the
      // placeholder itself, just enforced here instead of by Mongo.
      if (isUncategorized(posted.category)) {
        const resolved =
          resolveTier1(input.merchantNameNormalized, tier1Index) ??
          resolveTier2(
            { description: input.description, normalizedMerchant: input.merchantNameNormalized },
            { regex: tier2RegexRules, correctedMerchants },
          );
        if (resolved) {
          await deps.transactions.updateCategory(posted._id.toString(), resolved);
          if (resolved.tier === 1) categorizedTier1 += 1;
          else if (resolved.tier === 2) categorizedTier2 += 1;
        }
      }

      await supersedePending(tx, posted._id);
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
      pendingSuperseded,
      categorizedTier1,
      categorizedTier2,
    };
  }

  // Cursor-drift handling (ING-11, §6). Two distinct failures, two
  // distinct recoveries — conflating them is the trap here, since treating
  // a mutation as an invalid cursor throws away a perfectly good cursor
  // and forces a needless full resync.
  const startingCursor: string | null = connection.cursor ?? null;
  let attemptCursor: string | null = startingCursor;
  let drainRestarts = 0;
  let cursorWasReset = false;

  for (;;) {
    try {
      const result = await drain(attemptCursor);
      return { ...result, drainRestarts, cursorWasReset };
    } catch (err) {
      if (err instanceof ProviderCursorInvalidError && !cursorWasReset) {
        // The stored cursor is unusable. Clear it and start over from
        // empty — a full resync, which upserts make safe to repeat.
        await deps.connections.resetCursor(connectionId);
        cursorWasReset = true;
        attemptCursor = null;
        continue;
      }

      if (err instanceof ProviderSyncMutationError && drainRestarts < MAX_DRAIN_ATTEMPTS - 1) {
        // The data moved mid-pagination, so the pages gathered so far are
        // not a consistent view. Restart from where this run began — the
        // stored cursor stays untouched.
        drainRestarts += 1;
        attemptCursor = cursorWasReset ? null : startingCursor;
        continue;
      }

      throw err;
    }
  }
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
