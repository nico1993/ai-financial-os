import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// The standard shadcn/ui `cn()` helper: clsx resolves conditional
// className expressions, twMerge then dedupes conflicting Tailwind
// classes (e.g. a caller passing `p-2` to override a component's default
// `p-4`) so the last one wins instead of both landing in the DOM.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
