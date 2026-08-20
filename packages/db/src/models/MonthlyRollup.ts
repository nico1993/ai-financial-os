// MonthlyRollup — write-time cash-flow aggregate, same rollup-on-write
// pattern as DailyBalanceSnapshot (ARCHITECTURE.md §4.2, §4.4). The
// Monthly Cash Flow endpoint (ANLY-4) reads from here rather than grouping
// raw Transactions by $dateTrunc on every request. Transfers
// (excludeFromCashFlow: true) are excluded before these totals are computed.
import mongoose, { Schema, model, type Model } from "mongoose";

export interface MonthlyRollupDocument {
  _id: mongoose.Types.ObjectId;
  userId: string;
  /** UTC Date truncated to the first of the month ($dateTrunc unit: 'month'). */
  month: Date;
  /** Integer cents — sum of positive, non-transfer transaction amounts. */
  income: number;
  /** Integer cents, positive magnitude — sum of negative, non-transfer amounts. */
  expenses: number;
  createdAt: Date;
  updatedAt: Date;
}

const monthlyRollupSchema = new Schema<MonthlyRollupDocument>(
  {
    userId: { type: String, required: true },
    month: { type: Date, required: true },
    income: { type: Number, required: true },
    expenses: { type: Number, required: true },
  },
  { timestamps: true },
);

// One rollup per user per month — also the $merge upsert key.
monthlyRollupSchema.index({ userId: 1, month: 1 }, { unique: true });

export const MonthlyRollupModel: Model<MonthlyRollupDocument> =
  mongoose.models.MonthlyRollup ??
  model<MonthlyRollupDocument>("MonthlyRollup", monthlyRollupSchema);
