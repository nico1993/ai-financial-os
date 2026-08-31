import { describe, it, expect } from "vitest";
import {
  defaultAnalyticsRange,
  previousPeriodRange,
  formatDayLabel,
  formatMonthLabel,
} from "./dateRange";

describe("defaultAnalyticsRange", () => {
  it("spans the trailing 6 months ending today, inclusive", () => {
    const range = defaultAnalyticsRange(new Date("2026-08-31T15:00:00.000Z"));
    expect(range.end).toBe("2026-08-31");
    expect(range.start).toBe("2026-03-01");
  });

  it("handles a year boundary", () => {
    const range = defaultAnalyticsRange(new Date("2026-02-10T00:00:00.000Z"));
    expect(range.end).toBe("2026-02-10");
    expect(range.start).toBe("2025-09-01");
  });
});

describe("previousPeriodRange", () => {
  it("ends the day immediately before the range starts", () => {
    const compare = previousPeriodRange({ start: "2026-03-01", end: "2026-08-31" });
    expect(compare.end).toBe("2026-02-28");
  });

  it("produces a compare window the same number of days as the original", () => {
    const range = { start: "2026-06-01", end: "2026-06-10" };
    const compare = previousPeriodRange(range);
    const spanDays = (d: { start: string; end: string }) =>
      (new Date(`${d.end}T00:00:00.000Z`).getTime() -
        new Date(`${d.start}T00:00:00.000Z`).getTime()) /
      86_400_000;
    expect(spanDays(compare)).toBe(spanDays(range));
    expect(compare.end).toBe("2026-05-31");
    expect(compare.start).toBe("2026-05-22");
  });
});

describe("formatDayLabel", () => {
  it("formats a UTC date string as a short month + day", () => {
    expect(formatDayLabel("2026-03-15T00:00:00.000Z")).toBe("Mar 15");
  });
});

describe("formatMonthLabel", () => {
  it("formats a UTC date string as a short month + 2-digit year", () => {
    expect(formatMonthLabel("2026-01-01T00:00:00.000Z")).toBe("Jan 26");
  });
});
