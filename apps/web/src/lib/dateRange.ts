// lib/dateRange.ts — ANLY-9's shared date-range helpers. Pure logic (no
// React, no fetch), tested directly rather than through a mounted page,
// mirroring apps/api/src/analytics/netWorth.ts's own split between pure
// logic and the code that calls it (AGENTS.md's test-first rule for
// pure-logic stories).
//
// Every analytics page needs the same three things: a sensible default
// window to load on first render, a matching "previous period" window
// for the ANLY-6 compare toggle, and a couple of axis-label formatters
// the charts share.

export interface DateRangeValue {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The default window every analytics page loads with before the user
 * picks their own: the trailing 6 months up to and including today.
 * ARCHITECTURE.md deliberately never names a default (ADR-0035 — the
 * *backend* refuses to guess one, since that's a product decision), so
 * this is a frontend-only UX choice: six months is enough to show a real
 * trend on a line chart without asking a brand-new user's mostly-empty
 * history to fill a full year.
 */
export function defaultAnalyticsRange(now: Date = new Date()): DateRangeValue {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 5, 1));
  return { start: toDateString(start), end: toDateString(end) };
}

/** The comparison window for the cash-flow/spending-categories "vs.
 * previous period" toggle (ANLY-6): the same number of days immediately
 * preceding `range.start`, so a 6-month view compares against the prior
 * 6 months rather than some fixed calendar unit. */
export function previousPeriodRange(range: DateRangeValue): DateRangeValue {
  const start = new Date(`${range.start}T00:00:00.000Z`);
  const end = new Date(`${range.end}T00:00:00.000Z`);
  const spanMs = end.getTime() - start.getTime();
  const compareEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const compareStart = new Date(compareEnd.getTime() - spanMs);
  return { start: toDateString(compareStart), end: toDateString(compareEnd) };
}

// UTC-pinned formatters: the API's date/month values are UTC-midnight day
// boundaries (ADR-0034), so parsing with `new Date(iso)` and formatting
// with a UTC-pinned Intl formatter keeps a point's label from drifting a
// day in either direction depending on the viewer's own timezone.
const DAY_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

/** Chart-axis label for a single day (net worth series). */
export function formatDayLabel(iso: string): string {
  return DAY_LABEL_FORMAT.format(new Date(iso));
}

/** Chart-axis label for a calendar month (cash flow series). */
export function formatMonthLabel(iso: string): string {
  return MONTH_LABEL_FORMAT.format(new Date(iso));
}

/** WEB-10's "this calendar month" shortcut for the Transactions page
 * filter: the first through last day of `now`'s UTC calendar month,
 * inclusive -- day 0 of the *next* month is JS's own idiom for "the
 * last day of this month" (`Date.UTC` normalizes an out-of-range day
 * argument). */
export function currentCalendarMonthRange(now: Date = new Date()): DateRangeValue {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: toDateString(start), end: toDateString(end) };
}
