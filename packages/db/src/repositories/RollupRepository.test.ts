import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../test/mongo-memory.js";
import mongoose from "mongoose";
import { RollupRepository } from "./RollupRepository.js";

const db = setupTestDb();
const repo = new RollupRepository();

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

describe("RollupRepository", () => {
  describe("daily balance snapshots", () => {
    it("upsertDailyBalanceSnapshot creates, then updates the same day instead of duplicating it", async () => {
      const date = new Date("2026-01-15T00:00:00.000Z");
      await repo.upsertDailyBalanceSnapshot({
        userId: "user-1",
        date,
        netWorth: 10_000,
        assets: 10_000,
        liabilities: 0,
        accounts: [],
      });
      await repo.upsertDailyBalanceSnapshot({
        userId: "user-1",
        date,
        netWorth: 12_000,
        assets: 12_000,
        liabilities: 0,
        accounts: [],
      });

      const series = await repo.getNetWorthSeries("user-1", {
        start: new Date("2026-01-01"),
        end: new Date("2026-01-31"),
      });
      expect(series).toHaveLength(1);
      expect(series[0]?.netWorth).toBe(12_000);
    });

    it("upsertDailyBalanceSnapshot stores per-account balances as real ObjectIds from plain accountId strings", async () => {
      const accountId = new mongoose.Types.ObjectId().toString();
      const date = new Date("2026-01-15T00:00:00.000Z");

      await repo.upsertDailyBalanceSnapshot({
        userId: "user-1",
        date,
        netWorth: 5_000,
        assets: 5_000,
        liabilities: 0,
        accounts: [{ accountId, balance: 5_000 }],
      });

      const series = await repo.getNetWorthSeries("user-1", {
        start: new Date("2026-01-01"),
        end: new Date("2026-01-31"),
      });
      expect(series).toHaveLength(1);
      expect(series[0]?.accounts).toHaveLength(1);
      expect(series[0]?.accounts[0]?.accountId.toString()).toBe(accountId);
      expect(series[0]?.accounts[0]?.balance).toBe(5_000);
    });

    it("getNetWorthSeries returns the range sorted ascending by date", async () => {
      await repo.upsertDailyBalanceSnapshot({
        userId: "user-1",
        date: new Date("2026-01-20"),
        netWorth: 2,
        assets: 2,
        liabilities: 0,
        accounts: [],
      });
      await repo.upsertDailyBalanceSnapshot({
        userId: "user-1",
        date: new Date("2026-01-10"),
        netWorth: 1,
        assets: 1,
        liabilities: 0,
        accounts: [],
      });

      const series = await repo.getNetWorthSeries("user-1", {
        start: new Date("2026-01-01"),
        end: new Date("2026-01-31"),
      });
      expect(series.map((s) => s.netWorth)).toEqual([1, 2]);
    });
  });

  describe("getLatestNetWorthSnapshotBefore", () => {
    it("returns the most recent snapshot at or before the given date", async () => {
      await repo.upsertDailyBalanceSnapshot({
        userId: "user-1",
        date: new Date("2025-11-01"),
        netWorth: 1,
        assets: 1,
        liabilities: 0,
        accounts: [],
      });
      await repo.upsertDailyBalanceSnapshot({
        userId: "user-1",
        date: new Date("2025-12-15"),
        netWorth: 2,
        assets: 2,
        liabilities: 0,
        accounts: [],
      });
      await repo.upsertDailyBalanceSnapshot({
        userId: "user-1",
        date: new Date("2026-02-01"), // after the query date -- must be ignored
        netWorth: 3,
        assets: 3,
        liabilities: 0,
        accounts: [],
      });

      const result = await repo.getLatestNetWorthSnapshotBefore("user-1", new Date("2026-01-01"));
      expect(result?.netWorth).toBe(2);
    });

    it("returns null when there is no snapshot at or before the date yet", async () => {
      await repo.upsertDailyBalanceSnapshot({
        userId: "user-1",
        date: new Date("2026-03-01"),
        netWorth: 1,
        assets: 1,
        liabilities: 0,
        accounts: [],
      });

      const result = await repo.getLatestNetWorthSnapshotBefore("user-1", new Date("2026-01-01"));
      expect(result).toBeNull();
    });
  });

  describe("monthly rollups", () => {
    it("upsertMonthlyRollupBucket creates, then updates the same month instead of duplicating it", async () => {
      const month = new Date("2026-01-01T00:00:00.000Z");
      await repo.upsertMonthlyRollupBucket({
        userId: "user-1",
        month,
        income: 5000,
        expenses: 3000,
      });
      await repo.upsertMonthlyRollupBucket({
        userId: "user-1",
        month,
        income: 5200,
        expenses: 3100,
      });

      const rollups = await repo.getMonthlyRollup("user-1", {
        start: new Date("2026-01-01"),
        end: new Date("2026-01-31"),
      });
      expect(rollups).toHaveLength(1);
      expect(rollups[0]?.income).toBe(5200);
      expect(rollups[0]?.expenses).toBe(3100);
    });

    it("getMonthlyRollup returns the range sorted ascending by month", async () => {
      await repo.upsertMonthlyRollupBucket({
        userId: "user-1",
        month: new Date("2026-02-01"),
        income: 2,
        expenses: 2,
      });
      await repo.upsertMonthlyRollupBucket({
        userId: "user-1",
        month: new Date("2026-01-01"),
        income: 1,
        expenses: 1,
      });

      const rollups = await repo.getMonthlyRollup("user-1", {
        start: new Date("2026-01-01"),
        end: new Date("2026-02-28"),
      });
      expect(rollups.map((r) => r.income)).toEqual([1, 2]);
    });
  });
});
