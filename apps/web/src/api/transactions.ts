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
}

// Not under the ["analytics"] prefix ANLY-10's SSE client invalidates --
// this is a different failure/staleness mode. A newly-synced or
// newly-corrected transaction should still show up promptly, but that's
// each call site's job (CAT-7's category-correction mutation invalidates
// this key directly, the same way useExchangePublicTokenMutation()
// invalidates ["accounts"]), not something a dashboard-changed event has
// any business also triggering.
export function useTransactionsQuery(options: TransactionsQueryOptions) {
  const { page, pageSize, status } = options;
  return useQuery({
    queryKey: ["transactions", page, pageSize ?? null, status ?? null],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (pageSize) params.set("pageSize", String(pageSize));
      if (status) params.set("status", status);
      return apiFetch<TransactionsPageResponse>(`/api/transactions?${params.toString()}`);
    },
    // Keeps the current page's rows on screen while the next page loads,
    // instead of the table flashing to a loading state on every click --
    // React Query v5's replacement for v4's `keepPreviousData: true`.
    placeholderData: keepPreviousData,
  });
}

// -- CAT-7: manual category correction ------------------------------------

export interface CorrectCategoryInput {
  transactionId: string;
  category: string;
}

export interface CorrectCategoryResult {
  id: string;
  category: {
    value: string;
    status: TransactionCategoryStatus;
  };
}

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
      apiFetch<CorrectCategoryResult>(`/api/transactions/${transactionId}/category`, {
        method: "PATCH",
        body: { category },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics", "spending-categories"] });
    },
  });
}
