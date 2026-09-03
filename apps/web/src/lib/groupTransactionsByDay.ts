// lib/groupTransactionsByDay.ts — WEB-13's day-grouping for the
// transactions ledger's new layout: a header per calendar day showing
// that day's net total (e.g. "Aug 30, 2026 -- +$2,276.93"), transactions
// listed underneath it. Pure logic (no React, no fetch), tested directly
// rather than through a mounted page -- same split lib/dateRange.ts and
// lib/balanceGraphGranularity.ts already establish for this app's
// chart/list-adjacent pure logic (AGENTS.md's test-first rule).
import type { TransactionListItem } from "../api/transactions";

export interface TransactionDayGroup {
  /** UTC-midnight ISO string for this day -- the group's key, and what a
   * caller formats for the header label (a plain `new Date(group.date)`
   * plus an `Intl.DateTimeFormat` pinned to `timeZone: "UTC"`, the same
   * convention lib/dateRange.ts's formatDayLabel()/formatMonthLabel()
   * already use, so a day's transactions and its own header can't drift
   * to different calendar days depending on the viewer's timezone). */
  date: string;
  /**
   * This day's transactions summed and sign-flipped from
   * Transaction.amount's Plaid convention (positive = expense, negative =
   * income) to an ordinary signed delta (positive = the day netted a
   * gain, negative = a loss) -- formatSignedCents() (lib/money.ts) is
   * what renders this, the same flip getIncomeCategoryDistribution()
   * applies server-side for the same "a caller-facing total should never
   * carry Plaid's inverted sign" reason.
   */
  netTotal: number;
  items: TransactionListItem[];
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Groups `items` into one entry per calendar day (UTC), preserving each
 * group's position at wherever its first member first appeared -- correct
 * without needing a re-sort as long as `items` arrives already
 * date-descending, which every caller today does
 * (TransactionRepository.findPageForUser()'s own sort, unchanged by this
 * ticket). A same-day cluster split across two separately-fetched pages
 * (this function only ever sees one page at a time) simply renders as two
 * one-day groups rather than being merged across the page boundary -- an
 * accepted, minor artifact of keeping offset pagination unchanged, not a
 * bug in this function.
 */
export function groupTransactionsByDay(
  items: readonly TransactionListItem[],
): TransactionDayGroup[] {
  const groups: TransactionDayGroup[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const key = utcDayStart(new Date(item.date)).toISOString();
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({ date: key, netTotal: -item.amount, items: [item] });
    } else {
      const group = groups[existingIndex]!;
      group.netTotal -= item.amount;
      group.items.push(item);
    }
  }

  return groups;
}
