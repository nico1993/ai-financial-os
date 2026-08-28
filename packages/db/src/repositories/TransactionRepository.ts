// TransactionRepository — every persistence operation on Transaction goes
// through here (ADR-0005).
import { TransactionModel, type TransactionDocument } from "../models/Transaction.js";

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

  /** Links both sides of a matched transfer (ARCHITECTURE.md §2.4, XFER-3). */
  async applyTransferMatch(transactionIds: string[], transferGroupId: string): Promise<void> {
    await TransactionModel.updateMany(
      { _id: { $in: transactionIds } },
      { $set: { transferGroupId, excludeFromCashFlow: true } },
    );
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
}
