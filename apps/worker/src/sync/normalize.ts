// normalize.ts — pure functions the sync job hands off to (ARCHITECTURE.md
// §7.5: job handlers stay thin, real work lives in framework-free
// functions). No I/O, no BullMQ, no Mongoose calls — everything here is
// directly unit-testable.
import type { NormalizedTransaction } from "@financial-os/providers";
import type { TransactionDocument, UpsertTransactionInput } from "@financial-os/db";

/** The category the sync job stamps on a brand-new transaction, before any
 * categorization has run. Tier 4 / needs_review is the honest description
 * of that state — it lands in the review queue (§2.3) rather than
 * masquerading as a confirmed category — and it is self-healing: once
 * CAT-3 wires the Tier 1/2 resolvers into this job, and CAT-4 adds the LLM
 * pass, these get claimed automatically.
 *
 * Note this is only ever applied via `$setOnInsert` in
 * TransactionRepository.upsertFromSync(), so a later provider `modified`
 * event can't reset a real category back to this. */
export const UNCATEGORIZED: TransactionDocument["category"] = {
  tier: 4,
  value: "Uncategorized",
  status: "needs_review",
};

/** True if `category` is still exactly the sync job's placeholder -- CAT-3's
 * signal that Tier 1/2 (and later Tier 3) should still attempt to resolve
 * it. Checks the full shape rather than just `value`, so this stays
 * correct even if some future category legitimately reuses the string
 * "Uncategorized" for an unrelated purpose. */
export function isUncategorized(category: TransactionDocument["category"]): boolean {
  return (
    category.tier === UNCATEGORIZED.tier &&
    category.value === UNCATEGORIZED.value &&
    category.status === UNCATEGORIZED.status
  );
}

/** The Tier 1 exact-match lookup key (§2.3). Deliberately blunt for now:
 * lowercase, and collapse every run of non-alphanumerics to a single
 * space, so "SQ *BLUE_BOTTLE  COFFEE" and "Sq Blue Bottle Coffee" resolve
 * to the same key. CAT-1 owns any smarter normalization (stripping
 * processor prefixes, trailing reference numbers); because the raw text is
 * preserved on both Transaction.description and the RawPayload, this key
 * can be recomputed for every stored transaction if that logic changes. */
export function normalizeMerchantName(input: {
  merchantName?: string;
  description: string;
}): string {
  const source = input.merchantName?.trim() ? input.merchantName : input.description;
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Truncates to UTC midnight. Plaid's `date` is a calendar date, already
 * parsed as UTC midnight by the adapter — this must not shift it into
 * another day (AGENTS.md date convention). */
export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Truncates to the first of the UTC month — the MonthlyRollup bucket key. */
export function utcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** The last calendar day of `date`'s UTC month, truncated to UTC midnight
 * -- the inclusive upper bound for a $gte/$lte month-range query
 * (ANLY-1/ANLY-2's cash-flow rollup, ADR-0034). Every stored Transaction
 * date is already UTC midnight (Plaid's date is a calendar date, not a
 * moment in time), so a transaction on this exact day is correctly
 * included by an $lte comparison against it -- no need to reach into the
 * next day. `Date.UTC`'s day-of-month argument accepts 0 to mean "the
 * last day of the previous month," which is exactly this function's
 * month-plus-one-day-zero trick. */
export function utcMonthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export interface TransactionContext {
  userId: string;
  accountId: TransactionDocument["accountId"];
}

/** Maps one provider-normalized transaction onto the repository's input
 * shape. Amounts arrive as integer cents from the adapter and are passed
 * through untouched — no float math anywhere in this path. */
export function toTransactionInput(
  tx: NormalizedTransaction,
  ctx: TransactionContext,
): UpsertTransactionInput {
  return {
    userId: ctx.userId,
    accountId: ctx.accountId,
    providerTransactionId: tx.providerTransactionId,
    pendingTransactionId: tx.pendingTransactionId,
    date: tx.date,
    authorizedDate: tx.authorizedDate,
    amount: tx.amount,
    isoCurrencyCode: tx.isoCurrencyCode,
    merchantName: tx.merchantName,
    merchantNameNormalized: normalizeMerchantName(tx),
    description: tx.description,
    category: UNCATEGORIZED,
    // The provider's own raw category signal (Plaid's
    // personal_finance_category.detailed), passed straight through --
    // ADR-0029. Previously captured by PlaidProvider's normalizeTransaction()
    // onto NormalizedTransaction.providerCategory but dropped here before
    // it ever reached storage, leaving the transfer-matching pass (§2.4)
    // with no TRANSFER_-prefixed/payment-type signal to actually read.
    providerCategory: tx.providerCategory,
    pending: tx.pending,
    // transferGroupId / excludeFromCashFlow are deliberately absent: those
    // belong to the transfer-matching pass (XFER-3), and setting them here
    // would let a resync clobber a match it knows nothing about.
  };
}
