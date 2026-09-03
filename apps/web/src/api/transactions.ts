// api/transactions.ts — WEB-8's typed client for
// apps/api/src/routes/transactions.ts. Deliberately its own file rather
// than folded into api/accounts.ts or api/analytics.ts -- it's neither
// "what's linked" nor a dashboard aggregate, it's the raw ledger, and
// CAT-7's review queue (a `status: "needs_review"` call to the same
// hook) is expected to import straight from here rather than duplicating
// the fetch.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type TransactionCategoryStatus = "confirmed" | "needs_review";

export interface TransactionListItem {
  id: string;
  date: string; // ISO 8601, UTC
  merchantName: string;
  amount: number;
  isoCurrencyCode: string;
  pending: boolean;
  category: {
    value: string;
    status: TransactionCategoryStatus;
  };
  account: {
    id: string;
    institutionName: string;
    subtype: string;
    /** ACCT-3: mirrors the API's TransactionListItem -- see
     * lib/accountDisplayName.ts for the `nickname ?? officialName ??
     * institutionName` precedence used to render these. */
    officialName?: string;
    nickname?: string;
  };
}

export interface TransactionsPageResponse {
  items: TransactionListItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface TransactionsQueryOptions {
  page: number;
  pageSize?: number;
  /** CAT-7's review-queue filter -- omit for the plain ledger view. */
  status?: TransactionCategoryStatus;
  /** WEB-10: an inclusive date-range filter, "YYYY-MM-DD" (the same
   * string shape DateRangeControls/lib/dateRange.ts already use). */
  dateFrom?: string;
  dateTo?: string;
  /** WEB-10: exact category name -- what ANLY-14's Spending-page
   * drill-down links here with. */
  category?: string;
}

// Not under the ["analytics"] prefix ANLY-10's SSE client invalidates --
// this is a different failure/staleness mode. A newly-synced or
// newly-corrected transaction should still show up promptly, but that's
// each call site's job (CAT-7's category-correction mutation invalidates
// this key directly, the same way useExchangePublicTokenMutation()
// invalidates ["accounts"]), not something a dashboard-changed event has
// any business also triggering.
export function useTransactionsQuery(options: TransactionsQueryOptions) {
  const { page, pageSize, status, dateFrom, dateTo, category } = options;
  return useQuery({
    queryKey: [
      "transactions",
      page,
      pageSize ?? null,
      status ?? null,
      dateFrom ?? null,
      dateTo ?? null,
      category ?? null,
    ],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (pageSize) params.set("pageSize", String(pageSize));
      if (status) params.set("status", status);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (category) params.set("category", category);
      return apiFetch<TransactionsPageResponse>(`/api/transactions?${params.toString()}`);
    },
    // Keeps the current page's rows on screen while the next page loads,
    // instead of the table flashing to a loading state on every click --
    // React Query v5's replacement for v4's `keepPreviousData: true`.
    placeholderData: keepPreviousData,
  });
}

// -- CAT-7 / CAT-13: manual correction (category and/or merchant name) ----
//
// This hook, and CAT-12's wider one further down, both PATCH the same
// route, `/api/transactions/:id` (routes/transactions.ts) -- CAT-13
// broadened CAT-7's original `/category`-suffixed route to also accept
// `merchantNameOverride` rather than adding a second endpoint. Kept
// narrow here (not folded into CAT-12's useUpdateTransactionMutation)
// since ReviewCategoryControl.tsx, its one caller, only ever sets this
// one field and wants its own narrow input type, not an object where
// the other field happens to be undefined. CAT-13's own narrow
// merchant-only hook used to live here too, until CAT-12 retired its
// one caller (TransactionsTable.tsx's standalone inline editor) in
// favor of the popup below -- removed rather than left dead.

export interface TransactionUpdateResult {
  id: string;
  category: {
    value: string;
    status: TransactionCategoryStatus;
  };
  merchantName: string;
}

export interface CorrectCategoryInput {
  transactionId: string;
  category: string;
}

export type CorrectCategoryResult = TransactionUpdateResult;

/** A manual correction always writes `status: "confirmed"` (the API
 * enforces this server-side; there's no "needs_review" outcome for a
 * human's own decision) -- so on success this transaction has, by
 * definition, just left every `status: "needs_review"` query's result
 * set. Invalidating the `["transactions"]` prefix wholesale (not just
 * this one query key) is what makes it disappear from the review queue
 * immediately rather than on the next unrelated refetch. Also
 * invalidates `["analytics", "spending-categories"]` directly, the same
 * way `useExchangePublicTokenMutation()` invalidates `["accounts"]` --
 * ANLY-10's SSE client has no event for "a category changed," and this
 * is the same browser session that just made the edit, so there's
 * nothing for a push notification to tell it that a direct invalidation
 * doesn't already cover. */
export function useCorrectCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId, category }: CorrectCategoryInput) =>
      apiFetch<CorrectCategoryResult>(`/api/transactions/${transactionId}`, {
        method: "PATCH",
        body: { category },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics", "spending-categories"] });
    },
  });
}

// -- CAT-12: the transaction edit popup's combined save -------------------
//
// useCorrectCategoryMutation above (CAT-7) sets exactly one field, by
// design, for its one call site. CAT-12's popup can change both
// description and category in a single save, and the route already
// accepts both in one body -- so rather than firing two PATCHes (two
// round-trips, two invalidation cycles) when both changed, this is a
// second, wider hook for that one new shape of caller.
export interface UpdateTransactionInput {
  transactionId: string;
  /** Omit to leave the category unchanged. */
  category?: string;
  /** Omit to leave the merchant override unchanged; empty string clears
   * it back to `merchantName ?? merchantNameNormalized`, same
   * convention as CAT-13's own field. */
  merchantNameOverride?: string;
}

export type UpdateTransactionResult = TransactionUpdateResult;

/** Same reasoning as `useCorrectCategoryMutation` above for the
 * `["analytics", "spending-categories"]` invalidation, just conditional
 * on whether `category` was actually part of this particular save (a
 * merchant-only rename has no bearing on a category-grouped chart);
 * `["transactions"]` always gets invalidated either way. */
export function useUpdateTransactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId, category, merchantNameOverride }: UpdateTransactionInput) =>
      apiFetch<UpdateTransactionResult>(`/api/transactions/${transactionId}`, {
        method: "PATCH",
        body: { category, merchantNameOverride },
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      if (variables.category !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ["analytics", "spending-categories"] });
      }
    },
  });
}
