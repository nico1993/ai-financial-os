// SubscriptionRepository — every persistence operation on Subscription
// goes through here (ADR-0005). Written by ANLY-7's nightly batch job;
// ANLY-9's Subscriptions page only ever reads.
import mongoose from "mongoose";
import { SubscriptionModel, type SubscriptionDocument } from "../models/Subscription.js";

/** Plain-string transactionIds/accountId-shaped ids throughout, not
 * `mongoose.Types.ObjectId` — same reasoning as RollupRepository's
 * `UpsertDailyBalanceAccountEntry` (ADR-0034): the caller is
 * apps/worker's subscriptions queue glue, which doesn't depend on
 * mongoose directly, and neither does its upstream source (pure logic in
 * ../subscriptions/detect.ts). The ObjectId construction happens here,
 * the one place in this call chain allowed to know mongoose exists. */
export type UpsertDetectedSubscriptionInput = Pick<
  SubscriptionDocument,
  | "userId"
  | "merchantNameNormalized"
  | "merchantName"
  | "amount"
  | "intervalDays"
  | "frequency"
  | "lastTransactionDate"
  | "nextExpectedDate"
> & { transactionIds: string[] };

export class SubscriptionRepository {
  /** Upserts by (userId, merchantNameNormalized) — DATA-7's unique index,
   * also this job's natural idempotency key: re-running detection for a
   * merchant that's still recurring updates the same row rather than
   * duplicating it. Always sets `active: true` — this is only ever called
   * for a merchant the heuristic just re-confirmed as recurring on this
   * run (ANLY-7); a merchant that stops qualifying is handled by
   * `markInactive()` below, not by this method going unused for it. */
  async upsertDetected(input: UpsertDetectedSubscriptionInput): Promise<SubscriptionDocument> {
    const doc = await SubscriptionModel.findOneAndUpdate(
      { userId: input.userId, merchantNameNormalized: input.merchantNameNormalized },
      {
        $set: {
          merchantName: input.merchantName,
          amount: input.amount,
          intervalDays: input.intervalDays,
          frequency: input.frequency,
          lastTransactionDate: input.lastTransactionDate,
          nextExpectedDate: input.nextExpectedDate,
          transactionIds: input.transactionIds.map((id) => new mongoose.Types.ObjectId(id)),
          active: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return doc as SubscriptionDocument;
  }

  /** ANLY-9's Subscriptions page — reads only, sorted for a stable display
   * order rather than insertion/update order. */
  async findActiveByUser(userId: string): Promise<SubscriptionDocument[]> {
    return SubscriptionModel.find({ userId, active: true })
      .sort({ merchantName: 1 })
      .lean<SubscriptionDocument[]>();
  }

  /** A merchant the detection heuristic no longer confirms as recurring
   * this run — `Subscription.active`'s own doc comment: "False once the
   * merchant stops recurring — a lapsed subscription rather than a
   * deleted record, so history isn't lost." A no-op if the row is already
   * inactive or doesn't exist (nothing to lapse). */
  async markInactive(userId: string, merchantNameNormalized: string): Promise<void> {
    await SubscriptionModel.updateOne(
      { userId, merchantNameNormalized },
      { $set: { active: false } },
    );
  }

  /** AUTH-8/ADR-0047: erases every detected Subscription this user
   * owns, active or lapsed -- unlike markInactive() (ANLY-7's nightly
   * job, a real lapse worth keeping history of), account deletion means
   * none of it should remain. */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await SubscriptionModel.deleteMany({ userId });
    return result.deletedCount;
  }
}
