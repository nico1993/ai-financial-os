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

export class TransactionRepository {
  /** Upserts by providerTransactionId — the mechanism that makes Plaid's
   * added/modified/removed sync events safe to apply idempotently
   * (ARCHITECTURE.md §3.1, §3.2). */
  async upsertFromSync(input: UpsertTransactionInput): Promise<TransactionDocument> {
    const doc = await TransactionModel.findOneAndUpdate(
      { providerTransactionId: input.providerTransactionId },
      { $set: input },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return doc as TransactionDocument;
  }

  async findById(transactionId: string): Promise<TransactionDocument | null> {
    return TransactionModel.findById(transactionId).lean<TransactionDocument | null>();
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
}
