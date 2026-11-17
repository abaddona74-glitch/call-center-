import { formatUzPhone } from '@cc/shared';

const pad = (n: number) => String(n).padStart(2, '0');

/** Legacy formatSeconds: "MM:SS", or "H:MM:SS" from one hour. */
export function formatDuration(totalSec: number | null | undefined): string {
  const s = Math.max(0, Math.round(totalSec ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** "12 s. 34 daq." style long totals: hours and minutes ("12:34" with "s"). */
export function formatHoursMinutes(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}`;
}

/** "+998 (90) 123-45-67" for national numbers, raw text otherwise. */
export function formatPhone(number: string | null | undefined): string {
  return number ? formatUzPhone(number) : '';
}

export function formatNumber(n: number, locale = 'ru-RU'): string {
  return new Intl.NumberFormat(locale).format(n);
}
