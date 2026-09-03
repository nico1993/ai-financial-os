// transactions/list.ts — WEB-8's "general ledger" read side. Pure join
// of Transaction + Account (a Transaction stores only accountId --
// packages/db/src/models/Transaction.ts -- the same denormalization gap
// accounts/list.ts already bridges for Account+Connection), kept separate
// from the route handler and test-first for the same reason: AGENTS.md's
// convention for pure-logic stories, and this join has the same kind of
// edge case worth pinning down on purpose.
//
// XFER-7 added isTransferCandidate (below) -- not a Transaction+Account
// join like everything else here, just a resolved boolean over
// Transaction's own providerCategory (@financial-os/shared's
// isTransferSignalCategory()), sent as a plain field so ReviewPage.tsx
// doesn't need its own copy of Plaid's transfer-taxonomy check.
import type { AccountDocument, TransactionDocument } from "@financial-os/db";
import { isTransferSignalCategory } from "@financial-os/shared";

export interface TransactionListItem {
  id: string;
  date: string; // ISO 8601, UTC
  merchantName: string;
  amount: number;
  isoCurrencyCode: string;
  pending: boolean;
  category: {
    value: string;
    status: "confirmed" | "needs_review";
  };
  account: {
    id: string;
    institutionName: string;
    subtype: string;
    /** ACCT-3: an Account's `officialName`/`nickname` (ACCT-1's
     * user-chosen display name) were joined in for /accounts but never
     * for /transactions, so renaming an account here had zero visible
     * effect on this page. Display precedence stays the frontend's job
     * (`nickname ?? officialName ?? institutionName`, mirroring
     * accounts/list.ts's buildAccountList()) -- this just stops dropping
     * the fields on the floor. */
    officialName?: string;
    nickname?: string;
  };
  /** XFER-7: true when `providerCategory` carries a transfer/payment-type
   * signal (`isTransferSignalCategory()`, @financial-os/shared) --
   * resolved server-side rather than shipping the raw Plaid taxonomy
   * string to the frontend, the same "send a resolved view-model field,
   * not the raw data the frontend would have to interpret" choice this
   * function already makes for `merchantName`. The review queue
   * (ReviewPage.tsx) uses this to decide whether a `needs_review` row
   * gets the plain category-correction control or the "confirm external /
   * link transfer" choice. Meaningless (but harmless) on a row that isn't
   * `needs_review` -- nothing reads it there today. */
  isTransferCandidate: boolean;
}

/**
 * Joins each transaction to its account's institution/subtype for
 * display. Preserves the input order rather than re-sorting -- unlike
 * accounts/list.ts's buildAccountList(), the transactions passed in here
 * already arrived sorted and paginated by
 * TransactionRepository.findPageForUser(), and re-sorting a single page
 * of a larger, already-ordered result would at best waste work and at
 * worst silently misorder it if this is ever called with something
 * paginated by a field other than date.
 *
 * An accountId with no matching entry in `accounts` (an Account deleted
 * out from under its Transactions, or a caller passing mismatched data)
 * falls back to a placeholder rather than throwing -- the same defensive
 * posture buildAccountList() takes for an orphaned connectionId: one bad
 * row shouldn't take down the whole page.
 */
export function buildTransactionList(
  transactions: readonly TransactionDocument[],
  accounts: readonly AccountDocument[],
): TransactionListItem[] {
  const accountById = new Map(accounts.map((account) => [account._id.toString(), account]));

  return transactions.map((transaction) => {
    const accountId = transaction.accountId.toString();
    const account = accountById.get(accountId);

    return {
      id: transaction._id.toString(),
      date: transaction.date.toISOString(),
      // CAT-13: a user-set override wins the existing
      // merchantName ?? merchantNameNormalized fallback.
      merchantName:
        transaction.merchantNameOverride ??
        transaction.merchantName ??
        transaction.merchantNameNormalized,
      amount: transaction.amount,
      isoCurrencyCode: transaction.isoCurrencyCode,
      pending: transaction.pending,
      category: {
        value: transaction.category.value,
        status: transaction.category.status,
      },
      account: {
        id: accountId,
        institutionName: account?.institutionName ?? "Unknown account",
        subtype: account?.subtype ?? "",
        officialName: account?.officialName,
        nickname: account?.nickname,
      },
      isTransferCandidate: isTransferSignalCategory(transaction.providerCategory),
    };
  });
}
