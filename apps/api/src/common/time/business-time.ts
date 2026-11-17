import { BUSINESS_TIMEZONE } from '@cc/shared';
import { DateTime } from 'luxon';

/**
 * Wall-clock helpers for the business timezone (Asia/Tashkent).
 * PBX CDR datetimes are wall-clock strings "YYYY-MM-DD HH:mm:ss" in this zone (mysql2 dateStrings).
 * Parsing is hand-rolled because it runs for every CDR row; the zone offset is looked up once per date.
 */

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const offsetCache = new Map<string, number>();
const weekdayCache = new Map<string, number>();

/** UTC offset (minutes) of the business zone at noon of `date` (YYYY-MM-DD). */
export function zoneOffsetMinutes(date: string, zone = BUSINESS_TIMEZONE): number {
  const key = `${zone}|${date}`;
  let v = offsetCache.get(key);
  if (v === undefined) {
    v = DateTime.fromISO(`${date}T12:00:00`, { zone }).offset;
    if (offsetCache.size > 5000) offsetCache.clear();
    offsetCache.set(key, v);
  }
  return v;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export function isoWeekday(date: string): number {
  let v = weekdayCache.get(date);
  if (v === undefined) {
    const m = DATE_RE.exec(date);
    if (!m) throw new Error(`Invalid date "${date}"`);
    const js = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    v = js === 0 ? 7 : js;
    if (weekdayCache.size > 5000) weekdayCache.clear();
    weekdayCache.set(date, v);
  }
  return v;
}

export interface WallTime {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm:ss */
  time: string;
  hour: number;
  /** Seconds since local midnight. */
  secondOfDay: number;
  epochMs: number;
}

/** Parse "YYYY-MM-DD HH:mm:ss" (business-zone wall clock). */
export function parseWall(wall: string, zone = BUSINESS_TIMEZONE): WallTime {
  const m = WALL_RE.exec(wall);
  if (!m) throw new Error(`Invalid wall time "${wall}"`);
  const [, y, mo, d, h, mi, s] = m;
  const date = `${y}-${mo}-${d}`;
  const hour = Number(h);
  const secondOfDay = hour * 3600 + Number(mi) * 60 + Number(s);
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, Number(mi), Number(s));
  return { date, time: `${h}:${mi}:${s}`, hour, secondOfDay, epochMs: utc - zoneOffsetMinutes(date, zone) * 60_000 };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "YYYY-MM-DDTHH:mm:ss+05:00" for a business-zone wall time. */
export function wallToIso(wall: string, zone = BUSINESS_TIMEZONE): string {
  const w = parseWall(wall, zone);
  const off = zoneOffsetMinutes(w.date, zone);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${w.date}T${w.time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Business-zone wall time "YYYY-MM-DD HH:mm:ss" of an instant. */
export function epochToWall(epochMs: number, zone = BUSINESS_TIMEZONE): string {
  return DateTime.fromMillis(epochMs, { zone }).toFormat('yyyy-MM-dd HH:mm:ss');
}

export function todayInZone(zone = BUSINESS_TIMEZONE, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone }).toISODate() as string;
}

export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date "${date}"`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86_400_000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Inclusive list of dates from..to. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysInRange(from: string, to: string): number {
  return datesBetween(from, to).length;
}
