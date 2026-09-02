// components/ColorPicker.tsx — CAT-16: the color half of CategoriesPage's
// "small inline edit control (color + IconPicker re-use)." Mirrors
// IconPicker.tsx's own shape exactly (a `radiogroup` of buttons over a
// small curated set) rather than a free-form hex/native `<input
// type="color">` picker -- the same "curated, fixed set, not free-form"
// call CAT-11 already made for icons, applied here to color for
// consistency rather than mixing a constrained icon picker with an
// unconstrained color picker on the same row.
//
// The curated set is design/tokens.ts's own CATEGORICAL_PALETTE -- the
// exact 8 hues DEFAULT_CATEGORY_SEEDS cycles server-side (ADR-0028) and
// categories/palette.ts cycles for a freshly created custom category
// (CAT-14) -- so a color picked here is never a hue outside what this
// app already treats as "the" categorical palette.
import { CATEGORICAL_PALETTE } from "../design/tokens";
import { cn } from "../lib/utils";

export interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  className?: string;
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Category color"
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {CATEGORICAL_PALETTE.map((color) => {
        const selected = color === value;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color}
            title={color}
            onClick={() => onChange(color)}
            className={cn(
              "h-6 w-6 flex-shrink-0 rounded-full border-2 transition-colors",
              selected ? "border-ink" : "border-transparent hover:border-border",
            )}
            style={{ backgroundColor: color }}
          />
        );
      })}
    </div>
  );
}
