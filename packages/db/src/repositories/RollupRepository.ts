// RollupRepository — every persistence operation on DailyBalanceSnapshot
// and MonthlyRollup goes through here (ADR-0005). These are write-time
// aggregates (ARCHITECTURE.md §4.4): the rollup job upserts a bucket after
// every sync/transfer-match run; dashboard endpoints only ever read.
import {
  DailyBalanceSnapshotModel,
  type DailyBalanceSnapshotDocument,
} from "../models/DailyBalanceSnapshot.js";
import { MonthlyRollupModel, type MonthlyRollupDocument } from "../models/MonthlyRollup.js";
import type { DateRange } from "./TransactionRepository.js";

export type UpsertDailyBalanceSnapshotInput = Pick<
  DailyBalanceSnapshotDocument,
  "userId" | "date" | "netWorth" | "assets" | "liabilities" | "accounts"
>;

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
      { $set: input },
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

  /** Backs the Monthly Cash Flow endpoint (ANLY-4). */
  async getMonthlyRollup(userId: string, range: DateRange): Promise<MonthlyRollupDocument[]> {
    return MonthlyRollupModel.find({
      userId,
      month: { $gte: range.start, $lte: range.end },
    })
      .sort({ month: 1 })
      .lean<MonthlyRollupDocument[]>();
  }
}
