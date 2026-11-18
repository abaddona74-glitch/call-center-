import { DateTime } from 'luxon';

/**
 * Business-timezone date helpers of the callbacks module. Working days/hours/holidays are the shared
 * calendar (common/time/working-calendar.ts, WorkingCalendarService).
 */

export function toBusinessTime(at: Date, timezone: string): DateTime {
  return DateTime.fromJSDate(at, { zone: timezone });
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
