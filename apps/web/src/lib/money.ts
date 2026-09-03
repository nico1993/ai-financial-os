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
