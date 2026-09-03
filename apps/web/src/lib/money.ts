// lib/money.ts — every dollar amount in this app arrives from the API as
// integer cents (the convention documented across packages/db's models
// and hand-traced through apps/worker/src/rollups/recompute.ts), so this
// is the one place `/100` + Intl.NumberFormat happens rather than each
// chart or table re-deriving it.
const CURRENCY_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatCents(cents: number): string {
  return CURRENCY_FORMAT.format(cents / 100);
}

// WEB-12: Plaid's raw sign (amount > 0 = expense, amount < 0 = income --
// WEB-9's convention, untouched) is correct for call sites that color or
// filter by sign (TransactionsTable.tsx's row color, ANLY-5's spending
// filter, matching.ts's own doc comment), but pairing that with
// formatCents(item.amount)'s raw signed digits was backwards from how
// every consumer finance app actually displays an amount: an expense
// should carry the minus sign, income should not. This only flips what's
// *rendered as text* -- callers keep using Transaction.amount's real
// signed value for everything else (color, sorting, sign comparisons).
//
// XFER-7: extracted out of TransactionsTable.tsx (its original, and for a
// while only, caller) once TransferLinkDialog.tsx needed the exact same
// display rule for its own candidate list -- same "share it once a
// second consumer needs it" precedent as accountDisplayName.ts/
// categoryOptions.ts.
export function formatAmountDisplay(amount: number): string {
  if (amount === 0) return formatCents(0);
  return amount > 0 ? `-${formatCents(Math.abs(amount))}` : formatCents(Math.abs(amount));
}

// WEB-13: an explicit-sign dollar delta -- "+$2,276.93" for a net-positive
// day, "-$340.12" for net-negative -- for the transactions ledger's
// per-day net-total header and its "Total Period Change" stat.
// Deliberately the OPPOSITE input convention from formatAmountDisplay()
// above: that function's input is still Transaction.amount's raw Plaid
// sign (positive = expense), which it flips for display. This function's
// input is already an ordinary signed delta (positive = gained money,
// negative = lost money) -- a caller summing raw transaction amounts into
// a net total has already negated that sum itself (Plaid: amount > 0 =
// money leaving) before calling this, the same flip
// getIncomeCategoryDistribution() applies server-side so an "Income"
// figure never displays as negative.
export function formatSignedCents(cents: number): string {
  if (cents === 0) return formatCents(0);
  return cents > 0 ? `+${formatCents(cents)}` : `-${formatCents(Math.abs(cents))}`;
}
