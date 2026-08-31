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
