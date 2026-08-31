// components/DateRangeControls.tsx — the start/end date pickers every
// ANLY-9 page uses, plus the optional ANLY-6 "compare to previous
// period" toggle (cash flow, spending -- net worth has no compare
// concept, so it omits the two compare props entirely). Thin
// presentational glue, not pure logic, so it isn't test-first per
// AGENTS.md.
import type { ChangeEvent } from "react";
import { Input } from "./ui/input";
import type { DateRangeValue } from "../lib/dateRange";

interface DateRangeControlsProps {
  start: string;
  end: string;
  onChange: (next: DateRangeValue) => void;
  compareEnabled?: boolean;
  onCompareToggle?: (enabled: boolean) => void;
}

export function DateRangeControls({
  start,
  end,
  onChange,
  compareEnabled,
  onCompareToggle,
}: DateRangeControlsProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-ink">
        From
        <Input
          type="date"
          value={start}
          max={end}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onChange({ start: event.target.value, end })
          }
          className="h-8 w-36 text-xs"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink">
        To
        <Input
          type="date"
          value={end}
          min={start}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onChange({ start, end: event.target.value })
          }
          className="h-8 w-36 text-xs"
        />
      </label>
      {onCompareToggle && (
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-ink-secondary">
          <input
            type="checkbox"
            checked={compareEnabled ?? false}
            onChange={(event) => onCompareToggle(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-border"
          />
          Compare to previous period
        </label>
      )}
    </div>
  );
}
