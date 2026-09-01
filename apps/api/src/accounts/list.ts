// accounts/list.ts — WEB-7's "show what's already linked" read side. Pure
// join of Account + Connection (an account's own document has no status
// field -- that lives on its parent Connection, ARCHITECTURE.md §3.2), kept
// separate from the route handler and test-first for the same reason
// apps/api/src/analytics/*.ts are: AGENTS.md's convention for pure-logic
// stories, and this join has a real edge case worth pinning down (a
// connectionId with no matching Connection -- shouldn't happen given the
// foreign-key-by-convention write path in routes/plaid.ts, but a route
// handler reading two collections separately, not a single joined query,
// has no way to guarantee it, so this defaults defensively rather than
// throwing or silently dropping the account).
import type {
  AccountDocument,
  AccountType,
  ConnectionDocument,
  ConnectionStatus,
} from "@financial-os/db";

export interface AccountListItem {
  id: string;
  connectionId: string;
  connectionStatus: ConnectionStatus;
  /** ISO 8601, or `null` if this connection has never completed a sync
   * (ConnectionRepository.updateCursor() is the only writer -- ING-13).
   * Lets the frontend show "Never synced yet" / "Synced 3m ago" and,
   * combined with the manual-sync route (routes/accounts.ts), explain a
   * freshly linked account's empty transaction list instead of leaving
   * it unexplained. */
  connectionLastSyncedAt: string | null;
  institutionName: string;
  type: AccountType;
  subtype: string;
  officialName?: string;
  currentBalance: number;
  availableBalance?: number;
  isoCurrencyCode: string;
}

/**
 * Joins accounts to their connection's live status (and last-synced
 * timestamp, ING-13) and sorts for stable display -- by institution, then
 * account subtype, so a re-fetch after linking a new account doesn't
 * reshuffle the ones already on screen.
 *
 * A connectionId with no matching entry in `connections` (a Connection
 * deleted out from under its Accounts, or a caller passing mismatched
 * data) falls back to `"error"`/`null` rather than throwing -- `"error"`
 * is the one status this app already surfaces as "something's wrong,
 * look at this," so it's the honest thing to show rather than crashing
 * the whole list over one row.
 */
export function buildAccountList(
  accounts: readonly AccountDocument[],
  connections: readonly ConnectionDocument[],
): AccountListItem[] {
  const connectionById = new Map(
    connections.map((connection) => [connection._id.toString(), connection]),
  );

  return accounts
    .map((account) => {
      const connection = connectionById.get(account.connectionId.toString());
      return {
        id: account._id.toString(),
        connectionId: account.connectionId.toString(),
        connectionStatus: connection?.status ?? ("error" as ConnectionStatus),
        connectionLastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
        institutionName: account.institutionName,
        type: account.type,
        subtype: account.subtype,
        officialName: account.officialName,
        currentBalance: account.currentBalance,
        availableBalance: account.availableBalance,
        isoCurrencyCode: account.isoCurrencyCode,
      };
    })
    .sort((a, b) => {
      const byInstitution = a.institutionName.localeCompare(b.institutionName);
      return byInstitution !== 0 ? byInstitution : a.subtype.localeCompare(b.subtype);
    });
}
