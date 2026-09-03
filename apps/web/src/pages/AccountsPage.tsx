// pages/AccountsPage.tsx -- WEB-7: the Connect Account page. Doubles as
// the one place to see everything currently linked (institution, balance,
// connection health) and add another -- a persistent page reachable from
// the nav at any time, not just an empty-state prompt on first login,
// since the data model (AUTH-3/ADR-0018, ConnectionRepository.findByUserId
// returning an array) already supports more than one Connection per user
// and there needs to be somewhere to add a second one later. Decided here
// rather than left as an open question, since nothing about it is
// reversible-with-difficulty if it turns out wrong.
//
// ING-13 adds the "last synced" line and "Sync now" button per row --
// before this, a freshly linked account showed a balance and zero
// transactions with nothing on screen explaining why (the first sync
// wasn't triggered until this same story's backend fix, and even after
// that, a webhook-disabled local deployment has no other feedback that a
// sync is running at all).
import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import {
  useAccountsQuery,
  useCreateLinkTokenMutation,
  useExchangePublicTokenMutation,
  useRenameAccountMutation,
  useTriggerSyncMutation,
} from "../api/accounts";
import type { AccountListItem } from "../api/accounts";
import { getApiErrorMessage } from "../api/client";
import { accountDisplayName } from "../lib/accountDisplayName";
import { formatCents } from "../lib/money";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

const CONNECTION_STATUS_LABEL: Record<string, string> = {
  login_required: "Needs reconnect",
  error: "Connection error",
};

/** ACCT-1: inline rename control -- click the name to edit it in place,
 * Enter/blur to save, Escape to cancel. An empty save clears the
 * nickname back to `officialName ?? institutionName` (the API's own
 * empty-string-clears convention, routes/accounts.ts). */
function AccountNameEditor({ account }: { account: AccountListItem }) {
  const rename = useRenameAccountMutation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const displayName = accountDisplayName(account);

  function startEditing(): void {
    setDraft(account.nickname ?? "");
    setEditing(true);
  }

  function save(): void {
    const trimmed = draft.trim();
    if (trimmed !== (account.nickname ?? "")) {
      rename.mutate({ accountId: account.id, nickname: trimmed });
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          className="h-7 w-48 text-sm"
          value={draft}
          placeholder={account.officialName ?? account.institutionName}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={save}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="group flex items-center gap-1.5 text-left text-sm font-medium text-ink"
      onClick={startEditing}
      title="Rename this account"
    >
      {displayName}
      <span className="text-[11px] font-normal text-ink-muted underline decoration-dotted opacity-0 group-hover:opacity-100">
        Rename
      </span>
    </button>
  );
}

const SYNC_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "Never synced yet" / "Synced just now" / "Synced 3m ago" / a plain
 * date once it's more than a day old -- a relative time is only useful
 * while it's still short enough to read at a glance. */
function formatLastSynced(iso: string | null): string {
  if (!iso) return "Never synced yet";
  const syncedAt = new Date(iso);
  const minutesAgo = Math.floor((Date.now() - syncedAt.getTime()) / 60_000);
  if (minutesAgo < 1) return "Synced just now";
  if (minutesAgo < 60) return `Synced ${minutesAgo}m ago`;
  if (minutesAgo < 24 * 60) return `Synced ${Math.floor(minutesAgo / 60)}h ago`;
  return `Synced ${SYNC_TIME_FORMAT.format(syncedAt)}`;
}

export default function AccountsPage() {
  const accounts = useAccountsQuery();
  const createLinkToken = useCreateLinkTokenMutation();
  const exchangeToken = useExchangePublicTokenMutation();
  const triggerSync = useTriggerSyncMutation();
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
      {exchangeToken.isSuccess && (
        <p className="text-xs text-ink-secondary">
          Linked -- the first sync is running now. New transactions usually appear within a few
          minutes.
        </p>
      )}
      {triggerSync.isError && (
        <p role="alert" className="text-xs text-critical-text">
          {getApiErrorMessage(triggerSync.error, "Could not start a sync. Try again.")}
        </p>
      )}

      <div className="rounded-lg border border-border bg-surface">
        {accounts.isLoading ? (
          <p className="p-6 text-sm text-ink-muted">Loading…</p>
        ) : accounts.data && accounts.data.length > 0 ? (
          <ul className="divide-y divide-border">
            {accounts.data.map((account) => {
              const isSyncingThisConnection =
                triggerSync.isPending && triggerSync.variables === account.connectionId;
              return (
                <li key={account.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <AccountNameEditor account={account} />
                    <div className="text-xs text-ink-muted">
                      {account.institutionName} · {account.type} · {account.subtype}
                      {account.connectionStatus !== "active" && (
                        <span className="ml-2 text-critical-text">
                          {CONNECTION_STATUS_LABEL[account.connectionStatus]}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                      <span>{formatLastSynced(account.connectionLastSyncedAt)}</span>
                      <button
                        type="button"
                        className="font-medium text-ink underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isSyncingThisConnection}
                        onClick={() => triggerSync.mutate(account.connectionId)}
                      >
                        {isSyncingThisConnection ? "Syncing…" : "Sync now"}
                      </button>
                    </div>
                  </div>
                  <div className="font-mono text-sm tabular-nums text-ink">
                    {formatCents(account.currentBalance)}
                  </div>
                </li>
              );
            })}
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
