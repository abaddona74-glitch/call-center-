import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Icon } from './icon';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface DateRange {
  from: string;
  to: string;
}

export interface DateRangePreset extends DateRange {
  label: string;
}

/**
 * Legacy "Sana oralig'i" button (blue outline, calendar icon) with a popover: presets + two native date inputs.
 * Dates are plain YYYY-MM-DD strings (business timezone is the caller's concern).
 */
export function DateRangePicker({
  value,
  onChange,
  presets,
  max,
  labels,
  className,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  presets: DateRangePreset[];
  max?: string;
  labels: { button: string; from: string; to: string; apply: string };
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const valid = Boolean(draft.from && draft.to && draft.from <= draft.to);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(value);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-8 items-center gap-[7px] rounded-lg border border-chart-6/40 bg-chart-6/15 px-3.5 text-xs font-semibold text-chart-6 transition-all hover:bg-chart-6/25',
            className,
          )}
        >
          <Icon name="calendar" className="size-[15px]" />
          <span>{labels.button}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const active = p.from === value.from && p.to === value.to;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  onChange({ from: p.from, to: p.to });
                  setOpen(false);
                }}
                className={cn(
                  'rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-chart-4/40 hover:text-chart-4',
                  active && 'border-chart-4/60 bg-chart-4/15 text-chart-4',
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['from', 'to'] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground uppercase">
              {labels[k]}
              <input
                type="date"
                value={draft[k]}
                max={max}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                className="h-8 rounded-lg border border-white/8 bg-sidebar/75 px-2 text-xs text-foreground [color-scheme:dark] outline-none focus:border-primary"
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            onChange(draft);
            setOpen(false);
          }}
          className="mt-3 h-8 w-full rounded-lg bg-gradient-to-br from-chart-6 to-chart-6/85 text-xs font-semibold text-white disabled:opacity-40"
        >
          {labels.apply}
        </button>
      </PopoverContent>
    </Popover>
  );
}
