import { useEffect, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Icon } from './icon';
import { Modal, ModalHeader } from './modal';
import { type DateRangeValue, daysBetweenInclusive, fromDmy, RangeCalendar, toDmy } from './range-calendar';

export interface DateRangeModalLabels {
  quick: string;
  from: string;
  to: string;
  /** e.g. "Tanlangan oraliq: {{days}} kun ({{from}} — {{to}})" already interpolated by the caller */
  summary: (range: DateRangeValue, days: number) => string;
  monthNames: string[];
  weekdayNames: string[];
}

function DmyInput({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  max?: string;
}) {
  const [text, setText] = useState(toDmy(value));
  useEffect(() => setText(toDmy(value)), [value]);
  const parsed = fromDmy(text);
  const invalid = text !== '' && (!parsed || Boolean(max && parsed > max));
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-[12.5px] font-semibold text-foreground/85">
      <span>📅 {label}</span>
      <span className="relative">
        <input
          value={text}
          inputMode="numeric"
          placeholder="kk.oo.yyyy"
          onChange={(e) => {
            setText(e.target.value);
            const p = fromDmy(e.target.value);
            if (p && (!max || p <= max)) onChange(p);
          }}
          className={cn(
            'h-10 w-full rounded-lg border border-chart-6/45 bg-sidebar px-3 pr-9 text-[15px] font-bold text-white outline-none focus:border-chart-6',
            invalid && 'border-destructive',
          )}
        />
        <Icon
          name="calendar"
          className="pointer-events-none absolute top-1/2 right-3 size-[18px] -translate-y-1/2 text-muted-foreground"
        />
      </span>
    </label>
  );
}

/**
 * Legacy date-range modal (export "Hisobotni Export Qilish" / history "Sana oralig'i"): quick presets,
 * two Kun.Oy.Yil inputs, the inline range calendar and the "Tanlangan oraliq" summary; actions come from the caller.
 */
export function DateRangeModal({
  open,
  onOpenChange,
  initial,
  today,
  max,
  title,
  subtitle,
  icon,
  presets,
  labels,
  children,
  extra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: DateRangeValue;
  today: string;
  max?: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  presets: { label: string; from: string; to: string }[];
  labels: DateRangeModalLabels;
  /** Footer actions, given the current (valid) range. */
  children: (range: DateRangeValue, valid: boolean) => React.ReactNode;
  /** Extra fields between the inputs and the calendar. */
  extra?: React.ReactNode;
}) {
  const [range, setRange] = useState(initial);
  useEffect(() => {
    if (open) setRange(initial);
    // reset only when the modal opens
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const valid = Boolean(range.from && range.to && range.from <= range.to);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalHeader icon={icon} title={title} subtitle={subtitle} />
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2 text-[12.5px] font-semibold text-foreground/85">{labels.quick}</div>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setRange({ from: p.from, to: p.to })}
                className={cn(
                  'rounded-md border border-white/12 bg-white/5 px-3 py-[5px] text-xs font-semibold text-white transition-colors hover:bg-white/10',
                  p.from === range.from && p.to === range.to && 'border-chart-6/60 bg-chart-6/20',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3.5">
          <DmyInput
            label={labels.from}
            value={range.from}
            max={max}
            onChange={(from) => setRange((r) => ({ ...r, from }))}
          />
          <DmyInput label={labels.to} value={range.to} max={max} onChange={(to) => setRange((r) => ({ ...r, to }))} />
        </div>
        {extra}
        <RangeCalendar
          key={open ? range.to.slice(0, 7) : 'closed'}
          value={range}
          onChange={setRange}
          today={today}
          max={max}
          monthNames={labels.monthNames}
          weekdayNames={labels.weekdayNames}
        />
        {valid && (
          <div className="flex items-center gap-2 rounded-lg border border-chart-2/30 bg-chart-2/8 px-4 py-2.5 text-[12.5px] text-success">
            <Icon name="chart" className="size-4" />
            {labels.summary(range, daysBetweenInclusive(range.from, range.to))}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2.5">{children(range, valid)}</div>
      </div>
    </Modal>
  );
}
