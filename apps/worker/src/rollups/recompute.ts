// recompute.ts — ANLY-1/ANLY-2's actual rollup math (ARCHITECTURE.md §4.4,
// ADR-0008, ADR-0034), kept free of BullMQ and Mongoose (§7.5). The queue
// glue (../queues/rollups.ts) loads accounts/transactions and writes the
// result through RollupRepository; everything here is a pure function
// given data the caller already loaded, same split as
// sync/syncConnection.ts vs. categorize/tier1.ts.
import { utcDayStart } from "../sync/normalize.js";

export type RecomputeAccountType = "depository" | "credit" | "loan" | "investment";

export interface RecomputeAccount {
  id: string;
  type: RecomputeAccountType;
  /** Integer cents — Plaid's live balance, the one anchor point this
   * module has to work backward from (ADR-0034: Plaid exposes no
   * historical balance). */
  currentBalance: number;
  /** When this account first appeared in our system (Account.createdAt).
   * An account contributes nothing to a day's snapshot before this day —
   * the gap ANLY-11's chart renders, rather than a synthetic $0. */
  linkedAt: Date;
}

export interface RecomputeTransactionDelta {
  accountId: string;
  /** Integer cents, Plaid convention: positive = money leaving the
   * account, negative = money coming in (matching.ts, PlaidProvider.ts,
   * OllamaCategorizationProvider.ts all document the same convention). */
  amount: number;
}

export interface DailyBalanceSnapshotInput {
  netWorth: number;
  assets: number;
  liabilities: number;
  accounts: { accountId: string; balance: number }[];
}

/**
 * Reconstructs one day's DailyBalanceSnapshot (ADR-0034).
 *
 * Plaid exposes only each account's CURRENT balance, never a historical
 * one, so a past day's balance is derived by walking currentBalance
 * backward through every transaction dated strictly after that day:
 *
 *   balance(day) = currentBalance + sum(amount for tx dated after day)
 *
 * A later debit (positive amount) means the balance was HIGHER before it
 * left; a later credit (negative amount) means it was LOWER before it
 * arrived — adding the signed amount back undoes exactly that change.
 * This is what lets ADR-0008's targeted recompute correct an arbitrary
 * past day (a backdated `removed`/`modified` transaction), not just
 * "today."
 *
 * `transactionsAfterDay` must already be filtered by the caller
 * (../queues/rollups.ts) to this user, exclude removed and pending
 * transactions, and include only transactions dated strictly after `day`
 * — that filtering needs a database query this module has no business
 * making (§7.5). Pending is excluded deliberately: Plaid's `currentBalance`
 * is documented as the account's settled/official balance, and mixing an
 * uncertain pending-inclusion assumption into a dollar figure is a worse
 * failure mode than the alternative (a pending transaction's effect on
 * net worth simply lags a beat until it posts).
 *
 * An account not yet linked as of `day` (`linkedAt` truncated to UTC
 * midnight, compared inclusively) is omitted entirely — from the
 * per-account list and from assets/liabilities/netWorth alike.
 */
export function computeDailyBalanceSnapshot(
  day: Date,
  accounts: readonly RecomputeAccount[],
  transactionsAfterDay: readonly RecomputeTransactionDelta[],
): DailyBalanceSnapshotInput {
  const deltaByAccount = new Map<string, number>();
  for (const tx of transactionsAfterDay) {
    deltaByAccount.set(tx.accountId, (deltaByAccount.get(tx.accountId) ?? 0) + tx.amount);
  }

  const dayStart = utcDayStart(day).getTime();
  let assets = 0;
  let liabilities = 0;
  const accountEntries: { accountId: string; balance: number }[] = [];

  for (const account of accounts) {
    if (utcDayStart(account.linkedAt).getTime() > dayStart) continue;

    const balance = account.currentBalance + (deltaByAccount.get(account.id) ?? 0);
    accountEntries.push({ accountId: account.id, balance });

    // Credit/loan balances are Plaid's own positive-owed convention — no
    // sign flip needed, just a different bucket of the net worth sum.
    if (account.type === "credit" || account.type === "loan") {
      liabilities += balance;
    } else {
      assets += balance;
    }
  }

  return {
    netWorth: assets - liabilities,
    assets,
    liabilities,
    accounts: accountEntries,
  };
}

export interface RecomputeCashFlowTransaction {
  /** Integer cents, same Plaid sign convention as RecomputeTransactionDelta. */
  amount: number;
}

export interface MonthlyRollupInput {
  income: number;
  expenses: number;
}

/**
 * Computes one month's income/expense totals (ADR-0034). Unlike net worth,
 * this needs no anchor-point reconstruction — a month's income/expenses
 * are just this month's transactions summed, correct for any month
 * regardless of when it's computed.
 *
 * Established Plaid sign convention: positive amount = money leaving the
 * account (an expense), negative = money coming in (income) — this fixes
 * MonthlyRollup.ts's original doc comments, which had the two inverted
 * relative to every other place in this codebase that documents the same
 * convention (matching.ts, PlaidProvider.ts, OllamaCategorizationProvider.ts).
 *
 * `transactions` must already be filtered by the caller to this user, this
 * month, excluding removed and excludeFromCashFlow (transfer-matched)
 * transactions — same division of responsibility as
 * computeDailyBalanceSnapshot above. Unlike the balance reconstruction,
 * pending transactions ARE included here: a pending purchase is real
 * spending activity for cash-flow purposes, and supersedePending()
 * (sync/syncConnection.ts) already guarantees a transaction is never both
 * live-pending and live-posted at once (the pending row is marked
 * isRemoved once its posted counterpart lands), so there's no
 * double-counting risk the way there could be for a point-in-time balance.
 */
export function computeMonthlyRollup(
  transactions: readonly RecomputeCashFlowTransaction[],
): MonthlyRollupInput {
  let income = 0;
  let expenses = 0;
  for (const tx of transactions) {
    if (tx.amount > 0) expenses += tx.amount;
    else if (tx.amount < 0) income += -tx.amount;
  }
  return { income, expenses };
}
