// components/IconPicker.tsx — CAT-11's "basic UI: an icon picker
// somewhere reasonable (a simple grid/select is fine; the fuller
// integration point is CAT-12, not built here)." A plain button grid over
// CATEGORY_ICON_OPTIONS's curated, fixed set -- CAT-14's AddCategoryForm
// is this picker's one caller today; CAT-12's edit popup is expected to
// reuse it rather than build a second one.
import { CATEGORY_ICON_OPTIONS } from "../design/categoryIcons";
import { cn } from "../lib/utils";

export interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
  className?: string;
}

export function IconPicker({ value, onChange, className }: IconPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Category icon"
      className={cn("grid grid-cols-8 gap-1.5", className)}
    >
      {CATEGORY_ICON_OPTIONS.map(({ key, label, Icon }) => {
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            title={label}
            onClick={() => onChange(key)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border text-ink-secondary transition-colors",
              selected
                ? "border-accent bg-accent-wash text-accent"
                : "border-border bg-surface-secondary hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
