import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Icon } from './icon';

export interface DateRangeValue {
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** "2026-11-17" → "17.11.2026" (legacy Kun.Oy.Yil). */
export function toDmy(date: string): string {
  return date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : '';
}

/** "17.11.2026" → "2026-11-17", null when invalid. */
export function fromDmy(text: string): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return iso(y, mo - 1, d);
}

export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Legacy inline range calendar (export / audio-range modals): Monday first, Sat/Sun headers in red/blue,
 * selected days in blue, the start in bright blue, today in green. First click = start, second = end.
 */
export function RangeCalendar({
  value,
  onChange,
  today,
  max,
  monthNames,
  weekdayNames,
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  today: string;
  max?: string;
  /** 12 names, nominative. */
  monthNames: string[];
  /** 7 short names, Monday first. */
  weekdayNames: string[];
}) {
  const anchor = value.to || today;
  const [view, setView] = useState({ y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 });
  const [picking, setPicking] = useState<string | null>(null);

  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first offset
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const prevDays = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
  const cells: { date: string; day: number; outside: boolean }[] = [];
  for (let i = lead; i > 0; i--)
    cells.push({ date: iso(view.y, view.m - 1, prevDays - i + 1), day: prevDays - i + 1, outside: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: iso(view.y, view.m, d), day: d, outside: false });
  while (cells.length % 7) {
    const d = cells.length - lead - daysInMonth + 1;
    cells.push({ date: iso(view.y, view.m + 1, d), day: d, outside: true });
  }

  const from = picking ?? value.from;
  const to = picking ?? value.to;
  const shift = (delta: number) =>
    setView((v) => ({ y: v.y + Math.floor((v.m + delta) / 12), m: (((v.m + delta) % 12) + 12) % 12 }));

  return (
    <div className="rounded-xl border border-tint/10 bg-tint/[0.02] p-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-sm font-bold text-ink">
          {monthNames[view.m]} {view.y}
        </div>
        <div className="flex gap-1">
          {[-1, 1].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => shift(d)}
              aria-label={d < 0 ? 'Previous month' : 'Next month'}
              className="flex size-[26px] items-center justify-center rounded-md border border-tint/15 bg-tint/5 text-ink hover:bg-tint/10"
            >
              <Icon name={d < 0 ? 'arrow-left' : 'arrow-right'} className="size-3" />
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {weekdayNames.map((w, i) => (
          <div
            key={w}
            className={cn(
              'pb-1 text-[11px] font-semibold text-muted-foreground',
              i === 5 && 'text-destructive',
              i === 6 && 'text-shade-chart-6',
            )}
          >
            {w}
          </div>
        ))}
        {cells.map((c) => {
          const disabled = Boolean(max && c.date > max);
          const inRange = c.date >= from && c.date <= to;
          const isStart = c.date === from;
          const isToday = c.date === today;
          return (
            <button
              key={c.date}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (picking === null) setPicking(c.date);
                else {
                  const [a, b] = c.date < picking ? [c.date, picking] : [picking, c.date];
                  setPicking(null);
                  onChange({ from: a, to: b });
                }
              }}
              className={cn(
                'mx-px h-[26px] rounded-[3px] text-xs font-semibold text-ink transition-colors hover:bg-tint/10 disabled:pointer-events-none disabled:opacity-30',
                c.outside && 'text-muted-foreground/55',
                inRange && 'bg-chart-6/30 text-shade-chart-4',
                isToday && 'bg-chart-2 text-white',
                isStart && 'bg-chart-6 text-white',
              )}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
