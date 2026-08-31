import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

// shadcn/ui's Button shape, restyled to the tokens locked in from WEB-0's
// Mockup A (ADR-0030): near-black primary, thin border for outline/ghost,
// radius-sm buttons -- not shadcn's own default palette/radii.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-button-primary text-white hover:bg-button-primary-hover",
        outline: "border border-border bg-surface text-ink hover:bg-surface-secondary",
        ghost: "text-ink-secondary hover:bg-surface-secondary hover:text-ink",
        accent: "bg-accent text-white hover:opacity-90",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child element instead of a <button> (Radix's Slot
   * pattern) -- e.g. `<Button asChild><Link to="/login">Sign in</Link></Button>`
   * so the link keeps its own semantics instead of a button-in-a-button. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";
