// components/WalletsSection.tsx — ANLY-13's "Wallets" section, the first
// thing Overview shows. Replaces AccountsPage.tsx wholesale (that file is
// deleted by this same ticket) -- same data and mutations
// (useAccountsQuery, the Plaid Link connect flow, rename, sync-now,
// delete), reshaped from a `<ul>` list into a card grid per the ticket's
// own "Wallets section -- one card per linked Account" text, plus one new
// behavior: clicking a card navigates to `/transactions` filtered to that
// account (`?account=<id>`). That query param doesn't do anything yet --
// WEB-13 is what teaches TransactionsPage.tsx to read it -- so this link
// is inert (lands on the unfiltered ledger) until WEB-13 ships. Flagged
// as a known, accepted sequencing gap rather than a bug: building the
// link now (rather than leaving the card unclickable until WEB-13 lands)
// means this section doesn't need a second pass once it does.
import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Link } from "react-router-dom";
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
import { DeleteAccountButton } from "./DeleteAccountButton";
import { formatCents } from "../lib/money";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const CONNECTION_STATUS_LABEL: Record<string, string> = {
  login_required: "Needs reconnect",
  error: "Connection error",
};

/** Unchanged from AccountsPage.tsx (ACCT-1) -- click the name to edit it
 * in place, Enter/blur to save, Escape to cancel. Sits inside this card's
 * stretched-link click target (below), so its own interactive elements
 * need `relative` to paint above that link -- see WalletCard's comment. */
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
      <div className="relative z-10 flex items-center gap-1.5">
        <Input
          autoFocus
          className="h-7 text-sm"
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
      className="group/rename relative z-10 flex items-center gap-1.5 truncate text-left text-sm font-medium text-ink"
      onClick={startEditing}
      title="Rename this account"
    >
      <span className="truncate">{displayName}</span>
      <span className="flex-shrink-0 text-[11px] font-normal text-ink-muted underline decoration-dotted opacity-0 group-hover/rename:opacity-100">
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

/** Unchanged from AccountsPage.tsx (ING-13). */
function formatLastSynced(iso: string | null): string {
  if (!iso) return "Never synced yet";
  const syncedAt = new Date(iso);
  const minutesAgo = Math.floor((Date.now() - syncedAt.getTime()) / 60_000);
  if (minutesAgo < 1) return "Synced just now";
  if (minutesAgo < 60) return `Synced ${minutesAgo}m ago`;
  if (minutesAgo < 24 * 60) return `Synced ${Math.floor(minutesAgo / 60)}h ago`;
  return `Synced ${SYNC_TIME_FORMAT.format(syncedAt)}`;
}

interface WalletCardProps {
  account: AccountListItem;
  isSyncingThisConnection: boolean;
  onSync: () => void;
}

/** One card per linked Account. The whole card is a click target to
 * `/transactions?account=<id>` via a "stretched link" (an absolutely
 * positioned `<Link>` filling the card, painted first) -- every other
 * control on the card (rename, sync now, delete) is wrapped in
 * `relative z-10` so it paints above that link and keeps its own click
 * behavior instead of triggering navigation. This is the standard
 * clickable-card-with-nested-controls pattern (Bootstrap calls it
 * `.stretched-link`): a real `<a>` under the hood, not a `<div
 * onClick>`, so keyboard/screen-reader users still get a real link. */
function WalletCard({ account, isSyncingThisConnection, onSync }: WalletCardProps) {
  const displayName = accountDisplayName(account);
  return (
    <div className="relative flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-ink-muted">
      <Link
        to={`/transactions?account=${account.id}`}
        className="absolute inset-0 rounded-lg"
        aria-label={`View transactions for ${displayName}`}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <AccountNameEditor account={account} />
          <div className="truncate text-xs text-ink-muted">
            {account.institutionName} · {account.type} · {account.subtype}
          </div>
        </div>
        {account.connectionStatus !== "active" && (
          <span className="relative z-10 flex-shrink-0 whitespace-nowrap text-[11px] font-medium text-critical-text">
            {CONNECTION_STATUS_LABEL[account.connectionStatus]}
          </span>
        )}
      </div>

      <div className="font-mono text-xl font-medium tabular-nums text-ink">
        {formatCents(account.currentBalance)}
      </div>

      <div className="relative z-10 flex items-center justify-between gap-2 border-t border-border pt-2.5 text-xs text-ink-muted">
        <div className="flex items-center gap-2">
          <span>{formatLastSynced(account.connectionLastSyncedAt)}</span>
          <button
            type="button"
            className="font-medium text-ink underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSyncingThisConnection}
            onClick={onSync}
          >
            {isSyncingThisConnection ? "Syncing…" : "Sync now"}
          </button>
        </div>
        <DeleteAccountButton accountId={account.id} accountLabel={displayName} />
      </div>
    </div>
  );
}

/** ANLY-13: Overview's first section. See file header -- this replaces
 * AccountsPage.tsx (deleted by this same ticket) with the identical data
 * and mutations, reshaped into a card grid. */
export function WalletsSection() {
  const accounts = useAccountsQuery();
  const createLinkToken = useCreateLinkTokenMutation();
  const exchangeToken = useExchangePublicTokenMutation();
  const triggerSync = useTriggerSyncMutation();
  const [linkToken, setLinkToken] = useState<string | null>(null);

  // Unchanged from AccountsPage.tsx -- see that file's own retired
  // comment for why `open()` is called from the effect rather than
  // inline in the click handler.
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
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium tracking-tight text-ink">Wallets</h2>
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

      {accounts.isLoading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : accounts.data && accounts.data.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.data.map((account) => (
            <WalletCard
              key={account.id}
              account={account}
              isSyncingThisConnection={
                triggerSync.isPending && triggerSync.variables === account.connectionId
              }
              onSync={() => triggerSync.mutate(account.connectionId)}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
          No accounts linked yet. Connect a bank to get started.
        </p>
      )}
    </section>
  );
}
