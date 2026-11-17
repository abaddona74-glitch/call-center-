import { BUSINESS_TIMEZONE } from '@cc/shared';
import { DateTime } from 'luxon';

/**
 * Legacy timestamps come in several formats (docs/rewrite/legacy/data.md §1.0, §5.2).
 * These helpers return null for empty or unparsable input so the mapper can report it.
 */

function parseIn(value: string | null | undefined, zone: string): Date | null {
  const text = value?.trim();
  if (!text) return null;
  let dt = DateTime.fromSQL(text, { zone });
  if (!dt.isValid) dt = DateTime.fromISO(text, { zone });
  return dt.isValid ? dt.toJSDate() : null;
}

/**
 * Wall-clock text without an offset, written as Tashkent local time:
 * `toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' })` and `datetime('now','localtime')`
 * (the latter assumes the legacy server's OS timezone is Asia/Tashkent — confirm on prod).
 * `'2026-01-05 09:30:00'` → `2026-01-05T04:30:00.000Z`. Text with an explicit offset/`Z` keeps it.
 */
export function parseLegacyLocalTime(value: string | null | undefined): Date | null {
  return parseIn(value, BUSINESS_TIMEZONE);
}

/** SQLite `CURRENT_TIMESTAMP` / `datetime('now')` text, which is UTC. */
export function parseLegacyUtcTime(value: string | null | undefined): Date | null {
  return parseIn(value, 'UTC');
}
