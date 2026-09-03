// components/TransferReviewControl.tsx — XFER-7: ReviewPage.tsx's
// renderRowAction for a needs_review row (replaces ReviewCategoryControl
// there directly -- CAT-7's control still handles every row that isn't a
// transfer candidate, and is exactly what "confirm this is a real
// external transaction" falls through to below).
//
// Context (BACKLOG.md's own XFER-7 story text, since this is the feature
// the user found confusing): Plaid never links the two sides of a
// transfer between the user's own accounts. apps/worker's automated
// matching pass (XFER-1/2/3) already auto-links most pairs, and XFER-4
// ages anything that looked like a transfer but found no match into this
// same review queue after a few days -- until this story, that row was
// indistinguishable here from an ordinary miscategorized transaction.
// This control is what makes it distinguishable: a transaction whose
// isTransferCandidate flag is set (transactions/list.ts, server-resolved
// from Transaction.providerCategory) gets an explicit choice instead of
// going straight to the plain category picker.
import { useState } from "react";
import type { TransactionListItem } from "../api/transactions";
import { ReviewCategoryControl } from "./ReviewCategoryControl";
import { TransferLinkDialog } from "./TransferLinkDialog";
import { Button } from "./ui/button";

export interface TransferReviewControlProps {
  transaction: TransactionListItem;
}

// "choice" -- the two-button prompt below.
// "confirmExternal" -- the person picked the left button: this is a real
//   external transaction, not a transfer, so it falls through to CAT-7's
//   ordinary category-correction control for good. No way back to
//   "choice" -- that mirrors the ticket's own "falls through to the
//   ordinary category correction" wording, a one-way decision, not a
//   toggle.
// "linking" -- the person picked the right button: TransferLinkDialog is
//   open, showing ranked suggestions to pick a counterpart from.
type Mode = "choice" | "confirmExternal" | "linking";

export function TransferReviewControl({ transaction }: TransferReviewControlProps) {
  const [mode, setMode] = useState<Mode>("choice");

  // The common case: most needs_review rows have no transfer signal at
  // all, and get exactly what they always got pre-XFER-7.
  if (!transaction.isTransferCandidate || mode === "confirmExternal") {
    return <ReviewCategoryControl transaction={transaction} />;
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={() => setMode("confirmExternal")}>
          Confirm external
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("linking")}>
          Link transfer
        </Button>
      </div>
      <TransferLinkDialog
        transaction={transaction}
        open={mode === "linking"}
        onOpenChange={(open) => setMode(open ? "linking" : "choice")}
      />
    </>
  );
}
