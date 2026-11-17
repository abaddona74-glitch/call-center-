import { DateTime } from 'luxon';

/**
 * Working calendar of the call center (business timezone, weekdays, hours, holidays).
 * Hours are half-open: [workStart, workEnd) — 08:00:00 is working, 21:00:00 is not (fixes legacy B3).
 * Times are always converted to the business timezone explicitly; the host timezone never matters (B2).
 */
export interface WorkingCalendar {
  timezone: string;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  workDays: readonly number[];
  /** "HH:mm" */
  workStart: string;
  /** "HH:mm", exclusive */
  workEnd: string;
  /** "YYYY-MM-DD" in the business timezone. */
  holidays: readonly string[];
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function toBusinessTime(at: Date, timezone: string): DateTime {
  return DateTime.fromJSDate(at, { zone: timezone });
}

/** True when `at` falls inside working hours on a working, non-holiday day. */
export function isWorkingTime(at: Date, cal: WorkingCalendar): boolean {
  const t = toBusinessTime(at, cal.timezone);
  if (!t.isValid) return false;
  if (!cal.workDays.includes(t.weekday)) return false;
  if (cal.holidays.includes(t.toISODate() ?? '')) return false;
  const minute = t.hour * 60 + t.minute;
  return minute >= minutesOf(cal.workStart) && minute < minutesOf(cal.workEnd);
}

/** Calendar date ("YYYY-MM-DD") of `at` in the business timezone. */
export function businessDate(at: Date, timezone: string): string {
  return toBusinessTime(at, timezone).toISODate() ?? '';
}

/** [start, end) instants of a business-timezone calendar date. */
export function dayBounds(isoDate: string, timezone: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(isoDate, { zone: timezone }).startOf('day');
  if (!start.isValid) throw new RangeError(`Invalid date: ${isoDate}`);
  return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
}

/**
 * Parses a PBX wall-clock time ("YYYY-MM-DD HH:mm:ss", also with "/" or "T") as business time.
 * Strings with an explicit offset or "Z" keep it. Returns null when unparseable.
 */
export function parseBusinessDateTime(raw: string, timezone: string): Date | null {
  const text = raw.trim().replace(/\//g, '-');
  if (!text) return null;
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const iso = text.replace(' ', 'T');
  const dt = hasOffset ? DateTime.fromISO(iso, { setZone: true }) : DateTime.fromISO(iso, { zone: timezone });
  return dt.isValid ? dt.toJSDate() : null;
}

/** Formats an instant as PBX wall-clock text ("YYYY-MM-DD HH:mm:ss") for CDR queries. */
export function formatBusinessDateTime(at: Date, timezone: string): string {
  return toBusinessTime(at, timezone).toFormat('yyyy-LL-dd HH:mm:ss');
}
