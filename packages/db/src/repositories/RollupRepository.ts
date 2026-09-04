// RollupRepository — every persistence operation on DailyBalanceSnapshot
// and MonthlyRollup goes through here (ADR-0005). These are write-time
// aggregates (ARCHITECTURE.md §4.4): the rollup job upserts a bucket after
// every sync/transfer-match run; dashboard endpoints only ever read.
import mongoose from "mongoose";
import {
  DailyBalanceSnapshotModel,
  type DailyBalanceSnapshotDocument,
} from "../models/DailyBalanceSnapshot.js";
import { MonthlyRollupModel, type MonthlyRollupDocument } from "../models/MonthlyRollup.js";
import type { DateRange } from "./TransactionRepository.js";

/** Plain-string accountId, not `mongoose.Types.ObjectId` (ADR-0034): the
 * caller is apps/worker's rollups queue glue, which -- like every other
 * app in this monorepo -- doesn't depend on mongoose directly (only
 * packages/db does, ADR-0005's repository layering). Its upstream source,
 * rollups/recompute.ts's computeDailyBalanceSnapshot(), is pure logic with
 * no business knowing about a Mongoose type either. The ObjectId
 * construction happens right here, at the one place in the call chain
 * that's allowed to know mongoose exists. */
export interface UpsertDailyBalanceAccountEntry {
  accountId: string;
  balance: number;
}

export type UpsertDailyBalanceSnapshotInput = Pick<
  DailyBalanceSnapshotDocument,
  "userId" | "date" | "netWorth" | "assets" | "liabilities"
> & {
  accounts: UpsertDailyBalanceAccountEntry[];
};

export type UpsertMonthlyRollupInput = Pick<
  MonthlyRollupDocument,
  "userId" | "month" | "income" | "expenses"
>;

export class RollupRepository {
  /** Targeted bucket-scoped upsert (ADR-0008) — called for just the date
   * buckets a sync or transfer-matching run actually touched, not a full
   * recompute. */
  async upsertDailyBalanceSnapshot(
    input: UpsertDailyBalanceSnapshotInput,
  ): Promise<DailyBalanceSnapshotDocument> {
    const doc = await DailyBalanceSnapshotModel.findOneAndUpdate(
      { userId: input.userId, date: input.date },
      {
        $set: {
          ...input,
          accounts: input.accounts.map((entry) => ({
            accountId: new mongoose.Types.ObjectId(entry.accountId),
            balance: entry.balance,
          })),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return doc as DailyBalanceSnapshotDocument;
  }

  async upsertMonthlyRollupBucket(input: UpsertMonthlyRollupInput): Promise<MonthlyRollupDocument> {
    const doc = await MonthlyRollupModel.findOneAndUpdate(
      { userId: input.userId, month: input.month },
      { $set: input },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return doc as MonthlyRollupDocument;
  }

  /** Backs the Net Worth endpoint (ANLY-3) — reads only, never touches raw
   * Transactions (§4.2). */
  async getNetWorthSeries(
    userId: string,
    range: DateRange,
  ): Promise<DailyBalanceSnapshotDocument[]> {
    return DailyBalanceSnapshotModel.find({
      userId,
      date: { $gte: range.start, $lte: range.end },
    })
      .sort({ date: 1 })
      .lean<DailyBalanceSnapshotDocument[]>();
  }

  /** The single most recent snapshot at or before `date` (ANLY-3,
   * ADR-0035) — used to seed netWorth.ts's `fillNetWorthSeries()`
   * carry-forward starting point when the last real change predates the
   * requested range entirely (a quiet month whose last snapshot was in an
   * earlier one still has a true answer for day one). Index-backed by the
   * same `{userId, date}` unique index `getNetWorthSeries()` uses. */
  async getLatestNetWorthSnapshotBefore(
    userId: string,
    date: Date,
  ): Promise<DailyBalanceSnapshotDocument | null> {
    return DailyBalanceSnapshotModel.findOne({ userId, date: { $lte: date } })
      .sort({ date: -1 })
      .lean<DailyBalanceSnapshotDocument | null>();
  }

  /** Backs the Monthly Cash Flow endpoint (ANLY-4). */
  async getMonthlyRollup(userId: string, range: DateRange): Promise<MonthlyRollupDocument[]> {
    return MonthlyRollupModel.find({
      userId,
      month: { $gte: range.start, $lte: range.end },
    })
      .sort({ month: 1 })
      .lean<MonthlyRollupDocument[]>();
  }

  /** AUTH-8/ADR-0047: erases every DailyBalanceSnapshot and
   * MonthlyRollup this user owns -- the one deleteAllForUser() here that
   * has to touch two collections, since this repository already wraps
   * both (its own file header comment). Returns their combined count. */
  async deleteAllForUser(userId: string): Promise<number> {
    const [daily, monthly] = await Promise.all([
      DailyBalanceSnapshotModel.deleteMany({ userId }),
      MonthlyRollupModel.deleteMany({ userId }),
    ]);
    return daily.deletedCount + monthly.deletedCount;
  }
}
