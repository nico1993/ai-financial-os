// components/ui/dialog.tsx — CAT-12's modal primitive. Added
// @radix-ui/react-dialog rather than hand-rolling focus trap/Escape/
// overlay-click-outside/portal behavior from scratch -- the same call
// CategorySelect.tsx (CAT-15) made for Select, and ADR-0044's reasoning
// applies again: a real requirement (a row-click edit popup) outgrew
// what's safe to hand-roll correctly. Registry-checked: @radix-ui/
// react-dialog@1.1.23 (latest stable at the time this was added), peer
// range `^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc` covers this
// app's real react@^19.2.8.
//
// Styled against this app's own tokens rather than Radix's unstyled
// defaults -- the same "restyle the primitive, don't ship its default
// look" approach WEB-5/CategorySelect.tsx already established.
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { cn } from "../../lib/utils";

export const DialogRoot = Dialog.Root;
export const DialogTrigger = Dialog.Trigger;

export const DialogContent = forwardRef<
  ElementRef<typeof Dialog.Content>,
  ComponentPropsWithoutRef<typeof Dialog.Content>
>(function DialogContent({ className, children, ...props }, ref) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <Dialog.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2",
          "rounded-md border border-border bg-surface p-4 text-ink shadow-md",
          "focus:outline-none",
          className,
        )}
        {...props}
      >
        {children}
        <Dialog.Close
          className={cn(
            "absolute right-3 top-3 rounded-sm text-ink-muted",
            "hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20",
          )}
          aria-label="Close"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
});

export function DialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Dialog.Title>) {
  return <Dialog.Title className={cn("text-sm font-medium text-ink", className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Dialog.Description>) {
  return <Dialog.Description className={cn("text-xs text-ink-secondary", className)} {...props} />;
}
