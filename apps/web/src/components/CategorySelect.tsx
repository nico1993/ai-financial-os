// components/CategorySelect.tsx — CAT-15: a shared, styled listbox that
// renders each option as `{icon} {category name}`, not plain text. A
// native `<select>`/`<option>` can only ever render plain text in every
// real browser -- no icon, no SVG, no swatch -- so once "show the
// category's icon in the picker" became a real requirement (not a
// nice-to-have), hand-rolling a fully keyboard-accessible, focus-managed
// listbox from scratch was a lot of surface area to get right for
// something Radix already solves. ADR-0033's original "no Radix Select
// in this app's component set yet" precedent (ReviewCategoryControl.tsx)
// no longer applies for the same reason CAT-11 added lucide-react: a real
// requirement outgrew the plain-primitive approach. See ADR-0044 for the
// full dependency-addition reasoning (registry-checked version, peer
// range, @radix-ui/react-slot cross-check).
//
// Styled against this app's own tokens (design/tokens.ts) rather than
// Radix's unstyled defaults -- the same "restyle the primitive, don't
// ship its default look" approach WEB-5's shadcn components already
// established for @radix-ui/react-slot's Button asChild pattern.
//
// Two callers today: ReviewCategoryControl.tsx (CAT-7's manual
// correction, preserving its exact existing behavior -- current value
// shown even when it's not in the active category list, aria-label,
// disabled while a mutation is pending) and TransactionsPage.tsx's WEB-10
// category filter (preserving its unfiltered "All categories" option).
// Both build their own `options` array and hand it to this component --
// CategorySelect itself has no opinion on where an "All categories" or
// "not currently listed" entry comes from, only on how to render
// `{color swatch} {icon} {label}` consistently for whatever list it's
// given.
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { CategoryIcon } from "../design/categoryIcons";
import { cn } from "../lib/utils";

export interface CategorySelectOption {
  /** What `onChange` receives when this option is picked -- a category
   * name (ReviewCategoryControl, WEB-10's filter) or "" for an
   * unfiltered/no-op option ("All categories"). */
  value: string;
  label: string;
  /** A `Category.icon` key (design/categoryIcons.tsx) -- omitted
   * entirely (not just falsy) for an option that isn't a real category
   * row and shouldn't render an icon at all ("All categories"). */
  icon?: string;
  /** Hex swatch shown before the icon, same reasoning as `icon`. */
  color?: string;
}

export interface CategorySelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly CategorySelectOption[];
  ariaLabel: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

// Radix's <Select.Item> throws ("A <Select.Item /> must have a value
// prop that is not an empty string") if handed value="" -- it reserves
// the empty string internally to mean "no selection." WEB-10's "All
// categories" option is a real, meaningful "" value in this app's own
// filter state (TransactionsPage.tsx's own comment: "unlike the analytics
// pages, an empty range here is a valid, meaningful state"), so rather
// than push that Radix quirk onto every caller, it's translated at this
// component's own boundary: "" in, this sentinel to Radix, and back to ""
// on the way out. Callers never see the sentinel.
const EMPTY_VALUE_SENTINEL = "__cs_empty__";

export function CategorySelect({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
  placeholder,
  className,
}: CategorySelectProps) {
  const selected = options.find((o) => o.value === value);

  return (
    <Select.Root
      value={value === "" ? EMPTY_VALUE_SENTINEL : value}
      onValueChange={(next) => onChange(next === EMPTY_VALUE_SENTINEL ? "" : next)}
      disabled={disabled}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-8 min-w-0 items-center justify-between gap-1.5 rounded-md border border-border bg-surface-secondary px-2 text-xs text-ink",
          "focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {selected?.color && (
            <span
              aria-hidden="true"
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          )}
          {selected?.icon !== undefined && (
            <CategoryIcon
              icon={selected.icon}
              className="h-3.5 w-3.5 flex-shrink-0 text-ink-secondary"
            />
          )}
          <Select.Value placeholder={placeholder ?? "Select a category"}>
            {selected?.label ?? value}
          </Select.Value>
        </span>
        <Select.Icon>
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-ink-muted" aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] overflow-hidden rounded-md border border-border bg-surface text-ink shadow-md"
        >
          <Select.Viewport className="p-1">
            {options.map((option) => (
              <Select.Item
                key={option.value || EMPTY_VALUE_SENTINEL}
                value={option.value === "" ? EMPTY_VALUE_SENTINEL : option.value}
                className={cn(
                  "relative flex cursor-pointer select-none items-center gap-1.5 rounded-sm py-1.5 pl-2 pr-6 text-xs text-ink outline-none",
                  "data-[highlighted]:bg-accent-wash data-[highlighted]:text-ink",
                  "data-[state=checked]:font-medium",
                )}
              >
                {option.color && (
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                )}
                {option.icon !== undefined && (
                  <CategoryIcon
                    icon={option.icon}
                    className="h-3.5 w-3.5 flex-shrink-0 text-ink-secondary"
                  />
                )}
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="absolute right-2 flex items-center">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
