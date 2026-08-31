import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-border bg-surface-secondary px-3 text-sm text-ink placeholder:text-ink-muted",
        "focus-visible:border-ink focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
