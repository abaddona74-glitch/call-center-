import { BUSINESS_TIMEZONE } from '@cc/shared';

/** YYYY-MM-DD in Asia/Tashkent (the business day, independent of the browser's timezone). */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function shiftDate(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return `${date.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

export type RangePresetId = 'today' | 'yesterday' | 'week' | 'month' | 'prevMonth';

/** Quick ranges of the legacy date filter / export modal. */
export function rangePresets(today: string): Record<RangePresetId, { from: string; to: string }> {
  const prevMonthDay = shiftDate(monthStart(today), -1);
  return {
    today: { from: today, to: today },
    yesterday: { from: shiftDate(today, -1), to: shiftDate(today, -1) },
    week: { from: shiftDate(today, -6), to: today },
    month: { from: monthStart(today), to: today },
    prevMonth: { from: monthStart(prevMonthDay), to: prevMonthDay },
  };
}
