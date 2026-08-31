// pages/AccountsPage.tsx -- WEB-7: the Connect Account page. Doubles as
// the one place to see everything currently linked (institution, balance,
// connection health) and add another -- a persistent page reachable from
// the nav at any time, not just an empty-state prompt on first login,
// since the data model (AUTH-3/ADR-0018, ConnectionRepository.findByUserId
// returning an array) already supports more than one Connection per user
// and there needs to be somewhere to add a second one later. Decided here
// rather than left as an open question, since nothing about it is
// reversible-with-difficulty if it turns out wrong.
import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import {
  useAccountsQuery,
  useCreateLinkTokenMutation,
  useExchangePublicTokenMutation,
} from "../api/accounts";
import { getApiErrorMessage } from "../api/client";
import { formatCents } from "../lib/money";
import { Button } from "../components/ui/button";

const CONNECTION_STATUS_LABEL: Record<string, string> = {
  login_required: "Needs reconnect",
  error: "Connection error",
};

export default function AccountsPage() {
  const accounts = useAccountsQuery();
  const createLinkToken = useCreateLinkTokenMutation();
  const exchangeToken = useExchangePublicTokenMutation();
  const [linkToken, setLinkToken] = useState<string | null>(null);

  // react-plaid-link's own hook owns loading Plaid's script and the modal
  // itself. `ready` only flips true once a real token is set, so open()
  // is called from the effect below rather than inline in the click
  // handler -- calling it synchronously there would race the token fetch.
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken) => {
      if (publicToken) exchangeToken.mutate(publicToken);
      setLinkToken(null);
    },
    onExit: () => {
      setLinkToken(null);
    },
  });

  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  function handleConnect(): void {
    createLinkToken.mutate(undefined, {
      onSuccess: ({ linkToken: token }) => setLinkToken(token),
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-ink">Accounts</h1>
          <p className="text-sm text-ink-secondary">Linked bank and credit accounts.</p>
        </div>
        <Button onClick={handleConnect} disabled={createLinkToken.isPending}>
          {createLinkToken.isPending ? "Preparing…" : "Connect a bank"}
        </Button>
      </div>

      {createLinkToken.isError && (
        <p role="alert" className="text-xs text-critical-text">
          {getApiErrorMessage(createLinkToken.error, "Could not start Plaid Link. Try again.")}
        </p>
      )}
      {exchangeToken.isError && (
        <p role="alert" className="text-xs text-critical-text">
          {getApiErrorMessage(
            exchangeToken.error,
            "Could not finish linking that account. Try again.",
          )}
        </p>
      )}

      <div className="rounded-lg border border-border bg-surface">
        {accounts.isLoading ? (
          <p className="p-6 text-sm text-ink-muted">Loading…</p>
        ) : accounts.data && accounts.data.length > 0 ? (
          <ul className="divide-y divide-border">
            {accounts.data.map((account) => (
              <li key={account.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-ink">
                    {account.institutionName} · {account.officialName ?? account.subtype}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {account.type} · {account.subtype}
                    {account.connectionStatus !== "active" && (
                      <span className="ml-2 text-critical-text">
                        {CONNECTION_STATUS_LABEL[account.connectionStatus]}
                      </span>
                    )}
                  </div>
                </div>
                <div className="font-mono text-sm tabular-nums text-ink">
                  {formatCents(account.currentBalance)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-6 text-sm text-ink-muted">
            No accounts linked yet. Connect a bank to get started.
          </p>
        )}
      </div>
    </div>
  );
}
