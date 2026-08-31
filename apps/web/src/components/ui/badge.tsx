import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

// Two families, deliberately kept apart (see design/tokens.ts's own doc
// comment): `status` variants are the dataviz skill's reserved functional
// signals (only use for an actual state, never decoration); `tag` variants
// are minimalist-ui's decorative pastel accents for lightweight labels.
const badgeVariants = cva(
  "inline-flex items-center rounded-pill px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
  {
    variants: {
      variant: {
        "status-good": "bg-good-wash text-good-text",
        "status-warning": "bg-warning-wash text-warning-text",
        "status-serious": "bg-serious-wash text-serious-text",
        "status-critical": "bg-critical-wash text-critical-text",
        "tag-red": "bg-tag-red text-tag-red-text",
        "tag-blue": "bg-tag-blue text-tag-blue-text",
        "tag-green": "bg-tag-green text-tag-green-text",
        "tag-yellow": "bg-tag-yellow text-tag-yellow-text",
      },
    },
    defaultVariants: {
      variant: "tag-blue",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
