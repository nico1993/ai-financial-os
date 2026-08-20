// DailyBalanceSnapshot — write-time net worth aggregate, populated by a
// post-sync/nightly rollup job (ARCHITECTURE.md §3.2, §4.4). The Net Worth
// endpoint (ANLY-3) reads from here, never from raw Transactions at
// request time. Per-account balances are kept alongside the totals so the
// endpoint can render a gap for accounts before their first snapshot
// (partial backfill history, §4.2) instead of implying a $0 balance.
import mongoose, { Schema, model, type Model } from "mongoose";

export interface DailyBalanceAccountEntry {
  accountId: mongoose.Types.ObjectId;
  /** Integer cents. Signed — negative for liabilities (credit/loan). */
  balance: number;
}

export interface DailyBalanceSnapshotDocument {
  _id: mongoose.Types.ObjectId;
  userId: string;
  /** UTC Date truncated to day granularity (midnight). */
  date: Date;
  /** Integer cents. */
  netWorth: number;
  assets: number;
  liabilities: number;
  accounts: DailyBalanceAccountEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const dailyBalanceAccountSchema = new Schema<DailyBalanceAccountEntry>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    balance: { type: Number, required: true },
  },
  { _id: false },
);

const dailyBalanceSnapshotSchema = new Schema<DailyBalanceSnapshotDocument>(
  {
    userId: { type: String, required: true },
    date: { type: Date, required: true },
    netWorth: { type: Number, required: true },
    assets: { type: Number, required: true },
    liabilities: { type: Number, required: true },
    accounts: { type: [dailyBalanceAccountSchema], required: true, default: [] },
  },
  { timestamps: true },
);

// One snapshot per user per day — also the $merge upsert key the rollup
// job writes through (§4.4).
dailyBalanceSnapshotSchema.index({ userId: 1, date: 1 }, { unique: true });

export const DailyBalanceSnapshotModel: Model<DailyBalanceSnapshotDocument> =
  mongoose.models.DailyBalanceSnapshot ??
  model<DailyBalanceSnapshotDocument>("DailyBalanceSnapshot", dailyBalanceSnapshotSchema);
