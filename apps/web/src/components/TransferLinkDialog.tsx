// components/TransferLinkDialog.tsx — XFER-7's counterpart picker, opened
// by TransferReviewControl's "Link transfer" button. Fetches ranked
// suggestions from the new GET .../transfer-candidates route (only while
// `open`, via useTransferCandidatesQuery's `enabled`) and POSTs the
// chosen pair to .../link-transfer on a click.
//
// Controlled from the outside (open/onOpenChange), the same pattern
// TransactionEditDialog.tsx already established, rather than owning its
// own trigger -- TransferReviewControl is the trigger here.
import { useTransferCandidatesQuery, useLinkTransferMutation } from "../api/transactions";
import type { TransactionListItem } from "../api/transactions";
import { getApiErrorMessage } from "../api/client";
import { accountDisplayName } from "../lib/accountDisplayName";
import { formatAmountDisplay } from "../lib/money";
import { Button } from "./ui/button";
import { DialogRoot, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";

export interface TransferLinkDialogProps {
  transaction: TransactionListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function TransferLinkDialog({ transaction, open, onOpenChange }: TransferLinkDialogProps) {
  const candidates = useTransferCandidatesQuery(transaction.id, { enabled: open });
  const link = useLinkTransferMutation();

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Link transfer</DialogTitle>
        <DialogDescription className="mb-3">
          {transaction.merchantName} · {formatAmountDisplay(transaction.amount)} ·{" "}
          {DATE_FORMAT.format(new Date(transaction.date))}. Pick the other side of this transfer,
          ranked by closest date and amount.
        </DialogDescription>

        {candidates.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
        {candidates.isError && (
          <p className="text-sm text-critical-text">
            {getApiErrorMessage(candidates.error, "Could not load suggestions.")}
          </p>
        )}
        {candidates.data && candidates.data.items.length === 0 && (
          <p className="text-sm text-ink-muted">
            No likely match found in your other unmatched transactions.
          </p>
        )}
        {link.isError && (
          <p role="alert" className="text-xs text-critical-text">
            {getApiErrorMessage(link.error, "Could not link these transactions.")}
          </p>
        )}

        {candidates.data && candidates.data.items.length > 0 && (
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {candidates.data.items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-ink">{item.merchantName}</p>
                  <p className="truncate text-xs text-ink-secondary">
                    {accountDisplayName(item.account)} · {DATE_FORMAT.format(new Date(item.date))}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span className="font-mono tabular-nums text-ink-secondary">
                    {formatAmountDisplay(item.amount)}
                  </span>
                  <Button
                    size="sm"
                    disabled={link.isPending}
                    onClick={() =>
                      link.mutate(
                        { transactionId: transaction.id, counterpartId: item.id },
                        { onSuccess: () => onOpenChange(false) },
                      )
                    }
                  >
                    Link
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
