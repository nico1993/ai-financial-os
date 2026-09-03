// components/DeleteAccountButton.tsx — ACCT-2: "delete this account,"
// with a confirmation step first -- unlike ACCT-1's rename (freely
// reversible, no confirmation needed) or CAT-12's edit popup (Cancel is
// right there), this one's label says "delete," so a stray click
// shouldn't silently act on it even though the actual server-side
// effect is a reversible soft-archive, not a real deletion.
//
// Its own small file, not inlined into AccountsPage.tsx -- ANLY-13's
// planned Wallets cards are expected to want the exact same "delete
// this account" affordance, so this is built to be dropped in there
// too rather than re-derived a second time.
import { useState } from "react";
import { useDeleteAccountMutation } from "../api/accounts";
import { getApiErrorMessage } from "../api/client";
import { Button } from "./ui/button";
import { DialogRoot, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";

export interface DeleteAccountButtonProps {
  accountId: string;
  /** The account's own display name (accountDisplayName()'s result at
   * the call site) -- shown in the confirmation text so it's clear
   * which account is about to be deleted. */
  accountLabel: string;
  className?: string;
}

export function DeleteAccountButton({
  accountId,
  accountLabel,
  className,
}: DeleteAccountButtonProps) {
  const [open, setOpen] = useState(false);
  const deleteAccount = useDeleteAccountMutation();

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (!next) deleteAccount.reset();
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
        aria-label={`Delete ${accountLabel}`}
      >
        Delete
      </Button>
      {open && (
        <DialogContent>
          <DialogTitle>Delete {accountLabel}?</DialogTitle>
          <DialogDescription className="mb-3">
            This removes it from your accounts list. Its past transactions and balance history are
            kept, and this doesn&apos;t affect any other account at the same bank.
          </DialogDescription>
          {deleteAccount.isError && (
            <p role="alert" className="mb-3 text-xs text-critical-text">
              {getApiErrorMessage(deleteAccount.error, "Could not delete this account.")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={deleteAccount.isPending}
              onClick={() =>
                deleteAccount.mutate(accountId, {
                  onSuccess: () => setOpen(false),
                })
              }
            >
              {deleteAccount.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      )}
    </DialogRoot>
  );
}
