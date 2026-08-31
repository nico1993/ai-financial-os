// api/analytics.ts — ANLY-9's typed client for apps/api/src/routes/analytics.ts
// (ANLY-3..8). One file for all four dashboard endpoints, mirroring
// auth/session.ts's pattern of colocating each fetch call with the React
// Query hook that wraps it, rather than a separate hooks/ directory --
// apps/web has no such split anywhere else.
//
// Every query key here starts with `"analytics"` on purpose: it's the one
// prefix lib/useDashboardEvents.ts invalidates wholesale on every
// dashboard-changed SSE event (ANLY-10), so a new analytics query only
// has to join this file to be picked up automatically -- it doesn't also
// have to be added to the SSE handler's invalidation list.
//
// ANLY-10/ARCHITECTURE.md §4.3 also asks for a background-refetch
// fallback "in case the SSE connection drops" -- every hook below sets
// `refetchInterval` to a 5-minute poll (paused while the tab isn't
// visible, React Query's own default) so the dashboard still catches up
// eventually even if `/events` silently stops delivering, without
// polling aggressively enough to make the SSE push feel pointless.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

const BACKGROUND_REFETCH_FALLBACK_MS = 5 * 60_000;

export interface AnalyticsDateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

export interface AnalyticsCompareRange extends AnalyticsDateRange {
  compareStart?: string;
  compareEnd?: string;
}

function buildRangeQuery(range: AnalyticsCompareRange): string {
  const params = new URLSearchParams({ start: range.start, end: range.end });
  if (range.compareStart && range.compareEnd) {
    params.set("compareStart", range.compareStart);
    params.set("compareEnd", range.compareEnd);
  }
  return params.toString();
}

// -- Net worth (ANLY-3) ----------------------------------------------------

export interface NetWorthAccountBalance {
  accountId: string;
  balance: number;
}

export interface NetWorthPoint {
  date: string;
  netWorth: number;
  assets: number;
  liabilities: number;
  accounts: NetWorthAccountBalance[];
}

export function useNetWorthQuery(range: AnalyticsDateRange) {
  return useQuery({
    queryKey: ["analytics", "net-worth", range.start, range.end],
    queryFn: () => apiFetch<NetWorthPoint[]>(`/api/analytics/net-worth?${buildRangeQuery(range)}`),
    refetchInterval: BACKGROUND_REFETCH_FALLBACK_MS,
  });
}

// -- Cash flow (ANLY-4/ANLY-6) ---------------------------------------------

export interface CashFlowPoint {
  month: string;
  income: number;
  expenses: number;
}

export interface CashFlowResponse {
  current: CashFlowPoint[];
  compare: CashFlowPoint[] | null;
}

export function useCashFlowQuery(range: AnalyticsCompareRange) {
  return useQuery({
    queryKey: [
      "analytics",
      "cash-flow",
      range.start,
      range.end,
      range.compareStart ?? null,
      range.compareEnd ?? null,
    ],
    queryFn: () => apiFetch<CashFlowResponse>(`/api/analytics/cash-flow?${buildRangeQuery(range)}`),
    refetchInterval: BACKGROUND_REFETCH_FALLBACK_MS,
  });
}

// -- Spending categories (ANLY-5/ANLY-6) -----------------------------------

export interface CategoryDistributionItem {
  category: string;
  total: number;
}

export interface SpendingCategoriesResponse {
  current: CategoryDistributionItem[];
  compare: CategoryDistributionItem[] | null;
}

export function useSpendingCategoriesQuery(range: AnalyticsCompareRange) {
  return useQuery({
    queryKey: [
      "analytics",
      "spending-categories",
      range.start,
      range.end,
      range.compareStart ?? null,
      range.compareEnd ?? null,
    ],
    queryFn: () =>
      apiFetch<SpendingCategoriesResponse>(
        `/api/analytics/spending-categories?${buildRangeQuery(range)}`,
      ),
    refetchInterval: BACKGROUND_REFETCH_FALLBACK_MS,
  });
}

// -- Subscriptions (ANLY-7's read side) ------------------------------------

export type SubscriptionFrequency = "monthly" | "annual" | "other";

export interface SubscriptionItem {
  id: string;
  merchantName: string;
  amount: number;
  intervalDays: number;
  frequency: SubscriptionFrequency;
  lastTransactionDate: string;
  nextExpectedDate: string;
}

export function useSubscriptionsQuery() {
  return useQuery({
    queryKey: ["analytics", "subscriptions"],
    queryFn: () => apiFetch<SubscriptionItem[]>("/api/analytics/subscriptions"),
    refetchInterval: BACKGROUND_REFETCH_FALLBACK_MS,
  });
}
