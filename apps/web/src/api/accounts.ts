// api/accounts.ts — WEB-7's typed client: what's already linked
// (`useAccountsQuery`) plus the two-step Plaid Link flow
// (`useCreateLinkTokenMutation` fetches a link token on demand,
// `useExchangePublicTokenMutation` trades the public token Plaid Link
// hands back for a real Connection). Query key stays outside the
// `["analytics"]` prefix ANLY-10's SSE client invalidates -- linking an
// account doesn't itself change any dashboard number, the sync job that
// follows does, and that already has its own `rollup.completed` signal.
//
// ING-13 adds `connectionLastSyncedAt` to the list response and
// `useTriggerSyncMutation()` below -- before this, a freshly linked
// account had no transactions and nothing on screen explained why (the
// first sync waited on a webhook that's disabled locally, or the next
// scheduled poll).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type ConnectionStatus = "active" | "login_required" | "error";
export type AccountType = "depository" | "credit" | "loan" | "investment";

export interface AccountListItem {
  id: string;
  connectionId: string;
  connectionStatus: ConnectionStatus;
  /** ISO 8601, or `null` if this connection has never completed a sync. */
  connectionLastSyncedAt: string | null;
  institutionName: string;
  type: AccountType;
  subtype: string;
  officialName?: string;
  /** ACCT-1: a user-chosen name -- display precedence is
   * `nickname ?? officialName ?? institutionName` (AccountsPage.tsx). */
  nickname?: string;
  currentBalance: number;
  availableBalance?: number;
  isoCurrencyCode: string;
}

const ACCOUNTS_QUERY_KEY = ["accounts"] as const;

// A modest 30s background refetch while this query has an observer --
// ING-13's whole point is that syncing now has real feedback, and a
// timestamp that only updates on a manual page reload would defeat that.
// Cheap: GET /api/accounts is two indexed-by-userId reads plus an
// in-memory join, the same "poll a cheap read" precedent ANLY-9's
// dashboard queries already set (api/analytics.ts's 5-minute fallback),
// just shorter since "did my sync finish" is a tighter feedback loop than
// "did the dashboard change."
const SYNC_STATUS_POLL_MS = 30_000;

export function useAccountsQuery() {
  return useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: () => apiFetch<AccountListItem[]>("/api/accounts"),
    refetchInterval: SYNC_STATUS_POLL_MS,
  });
}

/** ING-13: forces an immediate re-sync of one connection instead of
 * waiting on PROVIDER_SYNC_POLL_INTERVAL_MS or a webhook that may never
 * arrive in a local dev deployment -- the third caller
 * `requestProviderSync()`'s own doc comment already anticipated
 * alongside the webhook and the scheduled poll. Doesn't invalidate
 * `["accounts"]` on success: the route only confirms the job was queued,
 * not that it finished, and `connectionLastSyncedAt` won't actually move
 * until it does -- the 30s poll above is what picks that up, the same
 * way linking a new bank doesn't optimistically show transactions that
 * haven't synced yet either. */
export function useTriggerSyncMutation() {
  return useMutation({
    mutationFn: (connectionId: string) =>
      apiFetch<{ status: string }>(`/api/accounts/${connectionId}/sync`, { method: "POST" }),
  });
}

/** Fetches a fresh Plaid Link token on demand -- not auto-run on mount,
 * since a token is only good for one Link session and there's no reason
 * to mint one before the user has actually asked to connect something. */
export function useCreateLinkTokenMutation() {
  return useMutation({
    mutationFn: () => apiFetch<{ linkToken: string }>("/api/plaid/link-token", { method: "POST" }),
  });
}

export interface ExchangeResult {
  connectionId: string;
  institutionName: string;
  accounts: Array<{
    id: string;
    providerAccountId: string;
    type: AccountType;
    subtype: string;
    currentBalance: number;
  }>;
}

export function useExchangePublicTokenMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (publicToken: string) =>
      apiFetch<ExchangeResult>("/api/plaid/exchange", { method: "POST", body: { publicToken } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
    },
  });
}

// -- ACCT-1: rename a linked account ---------------------------------------

export interface RenameAccountInput {
  accountId: string;
  /** Empty string clears the nickname back to
   * `officialName ?? institutionName` -- mirrors the API's own
   * clear-via-empty-string handling (routes/accounts.ts). */
  nickname: string;
}

export interface RenameAccountResult {
  id: string;
  nickname: string | null;
}

export function useRenameAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, nickname }: RenameAccountInput) =>
      apiFetch<RenameAccountResult>(`/api/accounts/${accountId}`, {
        method: "PATCH",
        body: { nickname },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
    },
  });
}
