// TransactionRepository — every persistence operation on Transaction goes
// through here (ADR-0005).
import {
  TransactionModel,
  type CategoryStatus,
  type TransactionDocument,
} from "../models/Transaction.js";

export type UpsertTransactionInput = Pick<
  TransactionDocument,
  | "userId"
  | "accountId"
  | "providerTransactionId"
  | "date"
  | "amount"
  | "isoCurrencyCode"
  | "merchantNameNormalized"
  | "description"
  | "category"
> &
  Partial<
    Pick<
      TransactionDocument,
      | "pendingTransactionId"
      | "authorizedDate"
      | "merchantName"
      | "providerCategory"
      | "transferGroupId"
      | "excludeFromCashFlow"
      | "pending"
      | "isRemoved"
    >
  >;

export interface DateRange {
  start: Date;
  end: Date;
}

/** WEB-8's general ledger page + CAT-7's Tier 4 review queue -- both are
 * "a page of this user's transactions, optionally narrowed by
 * category.status" (BACKLOG.md's own CAT-7 rescoping already names
 * `GET /api/transactions?status=needs_review` as the mechanism), so one
 * options shape and one repository method serve both rather than CAT-7
 * needing a second, near-duplicate query later. */
export interface TransactionPageOptions {
  /** 1-based. */
  page: number;
  pageSize: number;
  status?: CategoryStatus;
  /** WEB-10: an inclusive `date` window -- mirrors how the `ANLY` read
   * endpoints already take a `range` (ARCHITECTURE.md §4.2), reusing the
   * same `{userId, date: -1}` index this method's own doc comment
   * already cites. Either bound alone is valid (an open-ended "from X
   * onward"/"through Y" filter), not just the pair together. */
  dateFrom?: Date;
  dateTo?: Date;
  /** WEB-10: exact match against `category.value` -- what
   * ANLY-14's Spending-page drill-down links to. */
  category?: string;
}

export interface TransactionPage {
  items: TransactionDocument[];
  hasMore: boolean;
}

/** Tier 2's fuzzy-match candidate shape (apps/worker/src/categorize/tier2.ts's
 * CorrectedMerchant) -- declared independently here rather than imported,
 * since packages/db must not depend on apps/worker (ADR-0005's repository
 * layering runs the other direction). The two are kept structurally
 * identical on purpose. */
export interface CorrectedMerchantRow {
  normalizedMerchant: string;
  category: string;
}

export class TransactionRepository {
  /** Upserts by providerTransactionId — the mechanism that makes Plaid's
   * added/modified/removed sync events safe to apply idempotently
   * (ARCHITECTURE.md §3.1, §3.2).
   *
   * `category` is applied with `$setOnInsert`, not `$set`: it is the one
   * field on this document the *app* owns rather than the provider. A
   * Plaid `modified` event (an amount correction, a pending→posted flip)
   * would otherwise reset a transaction that Tier 1/2/3 had already
   * categorized — or worse, that the user had manually corrected via the
   * Tier 4 review queue — back to whatever placeholder the sync job passes
   * in. Re-categorization goes through updateCategory() instead. */
  async upsertFromSync(input: UpsertTransactionInput): Promise<TransactionDocument> {
    const { category, ...providerOwnedFields } = input;
    const doc = await TransactionModel.findOneAndUpdate(
      { providerTransactionId: input.providerTransactionId },
      { $set: providerOwnedFields, $setOnInsert: { category } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return doc as TransactionDocument;
  }

  async findById(transactionId: string): Promise<TransactionDocument | null> {
    return TransactionModel.findById(transactionId).lean<TransactionDocument | null>();
  }

  /** Looks a transaction up by the provider's id rather than ours — the
   * sync job needs this to read a soon-to-be-removed transaction's date
   * before soft-deleting it, so the rollup bucket that already counted it
   * can be recomputed (ADR-0008). */
  async findByProviderTransactionId(
    providerTransactionId: string,
  ): Promise<TransactionDocument | null> {
    return TransactionModel.findOne({ providerTransactionId }).lean<TransactionDocument | null>();
  }

  /** Powers most dashboard queries — filters by user, ranges by date
   * (ARCHITECTURE.md §3.2's "workhorse index"). Excludes soft-removed
   * transactions by default. */
  async findByUserAndDateRange(
    userId: string,
    range: DateRange,
    options: { includeRemoved?: boolean } = {},
  ): Promise<TransactionDocument[]> {
    return TransactionModel.find({
      userId,
      date: { $gte: range.start, $lte: range.end },
      ...(options.includeRemoved ? {} : { isRemoved: false }),
    })
      .sort({ date: -1 })
      .lean<TransactionDocument[]>();
  }

  /** WEB-8: every non-removed transaction for `userId`, most recent
   * first, sliced to `pageSize` rows starting at `page` -- offset
   * pagination, not a cursor, matching this app's general "the simplest
   * thing that works at single-user scale" posture elsewhere
   * (findUnmatchedTransferCandidates() et al.'s accepted full-history-scan
   * simplification). Fetches `pageSize + 1` rows and slices rather than
   * running a separate `countDocuments()` -- cheaper, and a raw total
   * isn't needed for anything here beyond "is there a next page."
   *
   * `status`, when given, narrows to `category.status` -- this is what
   * lets CAT-7's review queue reuse this exact method (`status:
   * "needs_review"`) instead of a second one. */
  async findPageForUser(userId: string, options: TransactionPageOptions): Promise<TransactionPage> {
    const { page, pageSize, status, category, dateFrom, dateTo } = options;
    const skip = (page - 1) * pageSize;

    const dateFilter: { $gte?: Date; $lte?: Date } = {};
    if (dateFrom) dateFilter.$gte = dateFrom;
    if (dateTo) dateFilter.$lte = dateTo;

    const docs = await TransactionModel.find({
      userId,
      isRemoved: false,
      ...(status ? { "category.status": status } : {}),
      ...(category ? { "category.value": category } : {}),
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
    })
      .sort({ date: -1 })
      .skip(skip)
      .limit(pageSize + 1)
      .lean<TransactionDocument[]>();

    const hasMore = docs.length > pageSize;
    return { items: hasMore ? docs.slice(0, pageSize) : docs, hasMore };
  }

  /** The Tier 4 review queue (ARCHITECTURE.md §2.3). */
  async findNeedsReview(userId: string): Promise<TransactionDocument[]> {
    return TransactionModel.find({ userId, "category.status": "needs_review", isRemoved: false })
      .sort({ date: -1 })
      .lean<TransactionDocument[]>();
  }

  /** The Tier 2 fuzzy-match pool (§2.3): merchants a human has actually
   * corrected via the Tier 4 review queue, read live from Transaction
   * rather than from MerchantRules -- CAT-6's write-back loop seeds an
   * exact-match MerchantRule row for the same normalized string, but this
   * covers near-miss variants that row alone wouldn't catch. Scoped to
   * tier 4 + confirmed: a routine Tier 1/2 auto-resolution is not "a human
   * corrected this," and folding it in here would just dilute the fuzzy
   * pool with matches Tier 1 already handles on its own. */
  async findCorrectedMerchants(userId: string): Promise<CorrectedMerchantRow[]> {
    const docs = await TransactionModel.find({
      userId,
      isRemoved: false,
      "category.tier": 4,
      "category.status": "confirmed",
    })
      .select("merchantNameNormalized category")
      .lean<Pick<TransactionDocument, "merchantNameNormalized" | "category">[]>();
    return docs.map((doc) => ({
      normalizedMerchant: doc.merchantNameNormalized,
      category: doc.category.value,
    }));
  }

  /** Soft-deletes on a Plaid "removed" sync event — never a hard delete,
   * so a rollup recompute can still see what changed (§4.4, §6). */
  async markRemoved(providerTransactionId: string): Promise<void> {
    await TransactionModel.updateOne({ providerTransactionId }, { $set: { isRemoved: true } });
  }

  async updateCategory(
    transactionId: string,
    category: TransactionDocument["category"],
  ): Promise<void> {
    await TransactionModel.updateOne({ _id: transactionId }, { $set: { category } });
  }

  /** CAT-7's manual correction: scoped to (transactionId, userId) together
   * so one user can never correct another's transaction via a guessed id
   * -- the same ownership check CategoryRepository.update() already
   * established for CAT-10. Returns the updated document (the route needs
   * `merchantNameNormalized` back off it for the write-back call) or null
   * on no match.
   *
   * Deliberately a NEW method rather than adding a `userId` parameter to
   * updateCategory() above -- every existing caller of that method
   * (categorizeLlm.ts, syncConnection.ts, transferMatching.ts) runs inside
   * a worker job with no authenticated user to scope against, and already
   * trusts the transactionId it was handed (ADR-0025's "work list from
   * the database" jobs, not a request from an untrusted caller). */
  async updateCategoryForUser(
    userId: string,
    transactionId: string,
    category: TransactionDocument["category"],
  ): Promise<TransactionDocument | null> {
    try {
      return await TransactionModel.findOneAndUpdate(
        { _id: transactionId, userId },
        { $set: { category } },
        { new: true },
      ).lean<TransactionDocument | null>();
    } catch (err) {
      // `transactionId` here is a client-supplied route param (CAT-7's
      // PATCH /api/transactions/:id/category is the first route in this
      // app to feed a raw client string into a Mongo `_id` filter) --
      // mongoose throws a CastError for anything that isn't a valid
      // ObjectId shape rather than just not matching. Treated the same
      // as a genuine no-match: the caller can't tell "malformed id" from
      // "no such transaction" apart anyway, and shouldn't have to --
      // both correctly become a 404, not a 500 with a stack trace.
      if (err instanceof Error && err.name === "CastError") {
        return null;
      }
      throw err;
    }
  }

  /** CAT-13: sets (or clears) this user's display-name override for a
   * transaction -- scoped to (transactionId, userId) together, the same
   * ownership check `updateCategoryForUser()` above already established,
   * and the same CastError-to-null tolerance for a malformed id.
   * `merchantNameOverride: null` clears it (`$unset`) rather than
   * writing an empty string, so `buildTransactionList()`'s
   * `merchantNameOverride ?? merchantName ?? merchantNameNormalized`
   * fallback correctly falls through to Plaid's own name instead of
   * displaying a blank merchant. Deliberately does not touch
   * `merchantNameNormalized` -- Tier 1/2 and Subscription's grouping key
   * keep reading that field unchanged (see its own doc comment on
   * `Transaction`). */
  async updateMerchantNameOverrideForUser(
    userId: string,
    transactionId: string,
    merchantNameOverride: string | null,
  ): Promise<TransactionDocument | null> {
    try {
      return await TransactionModel.findOneAndUpdate(
        { _id: transactionId, userId },
        merchantNameOverride === null
          ? { $unset: { merchantNameOverride: "" } }
          : { $set: { merchantNameOverride } },
        { new: true },
      ).lean<TransactionDocument | null>();
    } catch (err) {
      if (err instanceof Error && err.name === "CastError") {
        return null;
      }
      throw err;
    }
  }

  /** Links both sides of a matched transfer (ARCHITECTURE.md §2.4, XFER-3),
   * scoped to `userId` (XFER-7, user-confirmed 2026-09-02: "XFER-7 must
   * validate the request by the user's session id comparing whether the
   * tx id belongs to that customer"). This method's one caller before
   * XFER-7 was the worker job (queues/transferMatching.ts), which only
   * ever handed it ids drawn from findUnmatchedTransferCandidates(userId)
   * -- already a user-scoped pool -- so the missing check was latent, not
   * yet reachable by an untrusted caller. XFER-7 adds a route that lets a
   * browser request a link between two ids it picked itself, which is
   * exactly the case `updateCategoryForUser()`'s own "never trust a
   * client-supplied id alone" precedent exists for.
   *
   * Counts how many of `transactionIds`, scoped to `userId`, actually
   * exist *before* writing anything, and refuses (returns `false`, no
   * write performed) unless every one of them does. Without this,
   * `updateMany`'s `{_id: {$in: transactionIds}, userId}` filter would
   * silently apply a partial match when only one of the ids actually
   * belongs to the caller -- one transaction flagged as linked with no
   * real counterpart, and the other left completely untouched with no
   * error raised anywhere. Checked against `transactionIds.length`
   * rather than a hardcoded 2 -- every call today passes exactly a pair,
   * but the invariant this protects ("every id I was asked to link
   * really belongs to this user") doesn't depend on the pair size, so
   * there's no reason to bake that number in here. */
  async applyTransferMatch(
    userId: string,
    transactionIds: string[],
    transferGroupId: string,
  ): Promise<boolean> {
    const ownedCount = await TransactionModel.countDocuments({
      _id: { $in: transactionIds },
      userId,
    });
    if (ownedCount !== transactionIds.length) {
      return false;
    }

    await TransactionModel.updateMany(
      { _id: { $in: transactionIds }, userId },
      { $set: { transferGroupId, excludeFromCashFlow: true } },
    );
    return true;
  }

  /** The transfer-matching pass's full candidate pool for a user (§2.4,
   * XFER-1/XFER-2, ADR-0029): every settled, non-removed transaction not
   * already linked to a transferGroupId. Deliberately NOT filtered by
   * providerCategory here -- matching.ts's findTransferMatches() needs the
   * full pool, since §2.4 only requires *one* side of a matched pair to
   * carry a TRANSFER_-prefixed/payment-type signal, and the counterpart can be an
   * ordinary transaction with no provider category signal at all.
   * Excludes `pending: true`: a pending transaction's amount/date can
   * still change, and syncConnection.ts's supersedePending() does not
   * carry transferGroupId/excludeFromCashFlow across to the posted
   * replacement the way it carries `category` -- matching a pending row
   * would risk an orphaned link once it settles under a new document.
   * Full-history scan, no date windowing: an accepted Phase 1
   * simplification for this app's self-hosted, single-user scale
   * (ADR-0029) -- revisit if a real history ever makes this slow. */
  async findUnmatchedTransferCandidates(userId: string): Promise<TransactionDocument[]> {
    return TransactionModel.find({
      userId,
      isRemoved: false,
      pending: false,
      transferGroupId: { $exists: false },
    })
      .sort({ date: -1 })
      .lean<TransactionDocument[]>();
  }

  /** ANLY-1/ANLY-2's net worth reconstruction (ADR-0034): every
   * non-removed, non-pending transaction for `userId` dated strictly
   * after `afterDate`, projected down to just what
   * rollups/recompute.ts's computeDailyBalanceSnapshot() needs to walk an
   * account's currentBalance backward to what it was on that day. Pending
   * is excluded deliberately -- see computeDailyBalanceSnapshot()'s own
   * doc comment for why. Not scoped to one account: the caller needs
   * every touched account's deltas in one pass, then groups by accountId
   * itself (a single query beats one round trip per account). */
  async findAccountDeltasAfter(
    userId: string,
    afterDate: Date,
  ): Promise<{ accountId: string; amount: number }[]> {
    const docs = await TransactionModel.find({
      userId,
      isRemoved: false,
      pending: false,
      date: { $gt: afterDate },
    })
      .sort({ date: 1 })
      .select("accountId amount")
      .lean<Pick<TransactionDocument, "accountId" | "amount">[]>();
    return docs.map((doc) => ({ accountId: doc.accountId.toString(), amount: doc.amount }));
  }

  /** ANLY-1/ANLY-2's monthly cash-flow rollup (ADR-0034): every
   * non-removed, non-transfer-matched transaction for `userId` within
   * `range`, projected down to just the amount
   * rollups/recompute.ts's computeMonthlyRollup() sums. `excludeFromCashFlow`
   * is filtered with `$ne: true` rather than `false` so a transaction that
   * predates the field's default (none exist yet, but the pattern matches
   * TransactionRepository's own upsert-by-provider-id tolerance for
   * partially-set legacy documents) is still excluded from cash flow,
   * never included by an absent field reading as falsy. Pending IS
   * included -- see computeMonthlyRollup()'s own doc comment for why. */
  async findForCashFlow(userId: string, range: DateRange): Promise<{ amount: number }[]> {
    const docs = await TransactionModel.find({
      userId,
      isRemoved: false,
      excludeFromCashFlow: { $ne: true },
      date: { $gte: range.start, $lte: range.end },
    })
      .select("amount")
      .lean<Pick<TransactionDocument, "amount">[]>();
    return docs.map((doc) => ({ amount: doc.amount }));
  }

  /** ANLY-5's categorical spending distribution (ARCHITECTURE.md §4.2):
   * on-demand `$group` by `category.value`, `$sum` amount, pre-sorted
   * descending -- cheap enough to compute per-request given the
   * `{userId, 'category.value', date}` compound index (§3.2), unlike net
   * worth/cash flow's write-time rollups. `amount: {$gt: 0}` keeps this a
   * *spending* distribution (Plaid convention: positive = money leaving
   * the account) -- an income deposit or refund contributes to neither
   * slice. `excludeFromCashFlow` is filtered the same way
   * findForCashFlow() does, for the same reason: an internal transfer
   * between the user's own accounts isn't spending in any category. */
  async getCategoryDistribution(
    userId: string,
    range: DateRange,
  ): Promise<{ category: string; total: number }[]> {
    return TransactionModel.aggregate<{ category: string; total: number }>([
      {
        $match: {
          userId,
          isRemoved: false,
          excludeFromCashFlow: { $ne: true },
          amount: { $gt: 0 },
          date: { $gte: range.start, $lte: range.end },
        },
      },
      { $group: { _id: "$category.value", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
      { $project: { _id: 0, category: "$_id", total: 1 } },
    ]);
  }

  /** ANLY-13's "Period Income" donut (Overview page): the income-side
   * mirror of getCategoryDistribution() above -- same shape, same
   * exclusions (isRemoved, excludeFromCashFlow, date range), but
   * `amount: {$lt: 0}` (Plaid convention: negative = money in) instead of
   * `{$gt: 0}`. The summed total is negated in the aggregation itself so
   * it comes back an ordinary positive number -- an "Income" chart
   * showing negative figures would be confusing, the same reasoning
   * apps/web's own formatAmountDisplay() applies when rendering a signed
   * amount as text, just done here since this is a raw number a chart
   * sizes a slice by, not text that function would touch.
   *
   * No compare-range variant (unlike getCategoryDistributionComparison()
   * below) -- ANLY-13's Overview page doesn't expose a "compare to
   * previous period" toggle the way the now-retired SpendingPage.tsx did,
   * so nothing calls one yet. Add one the same way if that changes. */
  async getIncomeCategoryDistribution(
    userId: string,
    range: DateRange,
  ): Promise<{ category: string; total: number }[]> {
    return TransactionModel.aggregate<{ category: string; total: number }>([
      {
        $match: {
          userId,
          isRemoved: false,
          excludeFromCashFlow: { $ne: true },
          amount: { $lt: 0 },
          date: { $gte: range.start, $lte: range.end },
        },
      },
      { $group: { _id: "$category.value", total: { $sum: { $multiply: ["$amount", -1] } } } },
      { $sort: { total: -1 } },
      { $project: { _id: 0, category: "$_id", total: 1 } },
    ]);
  }

  /** ANLY-6's comparison-range variant of getCategoryDistribution() above:
   * both `range` and `compareRange` computed in one `$facet` aggregation
   * (ARCHITECTURE.md §4.2's own example) rather than two separate
   * `$match`+`$group` round trips against the raw Transactions collection
   * -- worth doing here specifically because Transactions is the large,
   * unbounded-growth collection this app has (unlike MonthlyRollup, a
   * small write-time aggregate RollupRepository.getMonthlyRollup() reads
   * with two cheap indexed point queries instead — see ADR-0035). The
   * outer `$match` pre-filters to the union of both ranges before the
   * `$facet` splits, so Mongo scans the combined window once, not twice. */
  async getCategoryDistributionComparison(
    userId: string,
    range: DateRange,
    compareRange: DateRange,
  ): Promise<{
    current: { category: string; total: number }[];
    compare: { category: string; total: number }[];
  }> {
    const overallStart =
      range.start.getTime() <= compareRange.start.getTime() ? range.start : compareRange.start;
    const overallEnd =
      range.end.getTime() >= compareRange.end.getTime() ? range.end : compareRange.end;

    // Explicit `as const` on every literal below: without it, TS widens
    // `-1`/`0`/`1` to plain `number` when inferring this array literal's
    // element type (no contextual pipeline-stage type to pin it against
    // until it's actually passed to .aggregate()), which then fails to
    // satisfy Mongoose's FacetPipelineStage union ($sort wants
    // `1 | -1 | Meta`, not `number`).
    const group = [
      { $group: { _id: "$category.value", total: { $sum: "$amount" } } },
      { $sort: { total: -1 as const } },
      { $project: { _id: 0 as const, category: "$_id", total: 1 as const } },
    ];

    const [result] = await TransactionModel.aggregate<{
      current: { category: string; total: number }[];
      compare: { category: string; total: number }[];
    }>([
      {
        $match: {
          userId,
          isRemoved: false,
          excludeFromCashFlow: { $ne: true },
          amount: { $gt: 0 },
          date: { $gte: overallStart, $lte: overallEnd },
        },
      },
      {
        $facet: {
          current: [{ $match: { date: { $gte: range.start, $lte: range.end } } }, ...group],
          compare: [
            { $match: { date: { $gte: compareRange.start, $lte: compareRange.end } } },
            ...group,
          ],
        },
      },
    ]);

    return result ?? { current: [], compare: [] };
  }

  /** ANLY-7's subscription-detection candidate pool: every non-removed,
   * non-pending, non-transfer-matched transaction for `userId`, sorted
   * ascending by date -- full-history scan, no date windowing, the same
   * accepted Phase 1 simplification `findUnmatchedTransferCandidates()`
   * documents for this app's self-hosted, single-user scale. `pending` is
   * excluded for the same reason `findAccountDeltasAfter()` excludes it:
   * a pending transaction's amount/date can still change, which would
   * corrupt the interval math a merchant's later posted transaction
   * already accounts for. `merchantName` falls back to
   * `merchantNameNormalized` -- Plaid's cleaned name is optional on
   * `Transaction`, but `Subscription.merchantName` is not, and the
   * normalized key is always populated. */
  async findSubscriptionCandidates(userId: string): Promise<
    {
      id: string;
      merchantNameNormalized: string;
      merchantName: string;
      amount: number;
      date: Date;
    }[]
  > {
    const docs = await TransactionModel.find({
      userId,
      isRemoved: false,
      pending: false,
      excludeFromCashFlow: { $ne: true },
    })
      .sort({ date: 1 })
      .select("merchantNameNormalized merchantName amount date")
      .lean<
        Pick<
          TransactionDocument,
          "_id" | "merchantNameNormalized" | "merchantName" | "amount" | "date"
        >[]
      >();
    return docs.map((doc) => ({
      id: doc._id.toString(),
      merchantNameNormalized: doc.merchantNameNormalized,
      merchantName: doc.merchantName ?? doc.merchantNameNormalized,
      amount: doc.amount,
      date: doc.date,
    }));
  }
}
