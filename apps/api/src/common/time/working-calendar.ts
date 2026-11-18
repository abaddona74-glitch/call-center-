import { BUSINESS_TIMEZONE, type WorkingCalendarInfo, type WorkingCalendarInput } from '@cc/shared';
import { epochToWall, isoWeekday, parseWall } from './business-time.js';

export interface WorkingCalendarConfig {
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  days: number[];
  /** "HH:mm", inclusive. */
  start: string;
  /** "HH:mm", exclusive ("24:00" = until midnight). */
  end: string;
  /** Non-working dates: "MM-DD" (every year) or "YYYY-MM-DD" (one date). */
  holidays?: string[];
  timezone?: string;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * The one working-time rule (owner decisions 2026-11-17/18: Mon–Fri 08:00–21:00 Asia/Tashkent plus holidays,
 * one calendar for statistics, callbacks and ticket deadlines, edited in the UI — WorkingCalendarService).
 * Half-open interval [start, end) so 21:00:00 is already after hours (fixes legacy B3).
 */
export class WorkingCalendar {
  readonly timezone: string;
  private readonly days: ReadonlySet<number>;
  private readonly holidays: ReadonlySet<string>;
  private readonly startSec: number;
  private readonly endSec: number;

  constructor(private readonly config: WorkingCalendarConfig) {
    this.timezone = config.timezone ?? BUSINESS_TIMEZONE;
    this.days = new Set(config.days);
    this.holidays = new Set(config.holidays ?? []);
    this.startSec = minutes(config.start) * 60;
    this.endSec = minutes(config.end) * 60;
    if (this.endSec <= this.startSec) throw new Error('Working hours: end must be after start');
  }

  static fromInput(input: WorkingCalendarInput): WorkingCalendar {
    return new WorkingCalendar({ days: input.days, start: input.start, end: input.end, holidays: input.holidays });
  }

  isHoliday(date: string): boolean {
    return this.holidays.has(date) || this.holidays.has(date.slice(5));
  }

  /** A working weekday that is not a holiday. */
  isWorkingDay(date: string): boolean {
    return this.days.has(isoWeekday(date)) && !this.isHoliday(date);
  }

  /** `date` YYYY-MM-DD + seconds since local midnight. */
  isWorkingAt(date: string, secondOfDay: number): boolean {
    return this.isWorkingDay(date) && secondOfDay >= this.startSec && secondOfDay < this.endSec;
  }

  /** Business-zone wall time "YYYY-MM-DD HH:mm:ss". */
  isWorkingWall(wall: string): boolean {
    const w = parseWall(wall, this.timezone);
    return this.isWorkingAt(w.date, w.secondOfDay);
  }

  /** An instant (callbacks: when a call started). */
  isWorkingInstant(at: Date): boolean {
    return this.isWorkingWall(epochToWall(at.getTime(), this.timezone));
  }

  /** Hours of the day that overlap working time, e.g. 8..20 for 08:00–21:00 (hourly charts). */
  workingHours(): number[] {
    const out: number[] = [];
    for (let h = 0; h < 24; h++) {
      if (h * 3600 + 3599 >= this.startSec && h * 3600 < this.endSec) out.push(h);
    }
    return out;
  }

  info(): WorkingCalendarInfo {
    return {
      timezone: this.timezone,
      days: [...this.days].sort(),
      start: this.config.start,
      end: this.config.end,
      holidays: [...this.holidays].sort(),
    };
  }
}
