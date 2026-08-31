// api/accounts.ts — WEB-7's typed client: what's already linked
// (`useAccountsQuery`) plus the two-step Plaid Link flow
// (`useCreateLinkTokenMutation` fetches a link token on demand,
// `useExchangePublicTokenMutation` trades the public token Plaid Link
// hands back for a real Connection). Query key stays outside the
// `["analytics"]` prefix ANLY-10's SSE client invalidates -- linking an
// account doesn't itself change any dashboard number, the sync job that
// follows does, and that already has its own `rollup.completed` signal.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type ConnectionStatus = "active" | "login_required" | "error";
export type AccountType = "depository" | "credit" | "loan" | "investment";

export interface AccountListItem {
  id: string;
  connectionId: string;
  connectionStatus: ConnectionStatus;
  institutionName: string;
  type: AccountType;
  subtype: string;
  officialName?: string;
  currentBalance: number;
  availableBalance?: number;
  isoCurrencyCode: string;
}

const ACCOUNTS_QUERY_KEY = ["accounts"] as const;

export function useAccountsQuery() {
  return useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: () => apiFetch<AccountListItem[]>("/api/accounts"),
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
