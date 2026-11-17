import type { TicketStatus } from '@cc/shared';
import { DateTime } from 'luxon';

/**
 * Ticket SLA: N working days (owner: 3; Mon–Fri, holidays excluded, Asia/Tashkent) from creation to
 * done/rejected. The working days come from the shared WorkingCalendar (common/time/working-calendar.ts).
 *
 * Due time = the creation wall-clock time, N working days later. A ticket opened on a non-working day
 * starts counting at 00:00 of the next working day (Saturday → due Thursday 00:00 for N = 3).
 */
export interface WorkingDays {
  timezone: string;
  /** "YYYY-MM-DD" in the business timezone. */
  isWorkingDay(date: string): boolean;
}

const MAX_SCAN_DAYS = 400;

function nextWorkingDay(dt: DateTime, cal: WorkingDays): DateTime {
  let d: DateTime = dt;
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    d = d.plus({ days: 1 });
    if (cal.isWorkingDay(d.toISODate() as string)) return d;
  }
  throw new Error('Working calendar has no working days');
}

export function slaDueAt(createdAt: Date, workingDays: number, cal: WorkingDays): Date {
  if (!Number.isInteger(workingDays) || workingDays < 1) throw new RangeError('SLA must be at least one working day');
  let d: DateTime = DateTime.fromJSDate(createdAt, { zone: cal.timezone });
  if (!cal.isWorkingDay(d.toISODate() as string)) d = nextWorkingDay(d, cal).startOf('day');
  for (let i = 0; i < workingDays; i++) d = nextWorkingDay(d, cal);
  return d.toJSDate();
}

export interface SlaFacts {
  status: TicketStatus;
  dueAt: Date | null;
  resolvedAt: Date | null;
}

/**
 * Overdue = done/rejected later than the due time, or still with the region after it.
 * Tickets resolved in time stay "in time" through the callback step.
 */
export function isOverdue(t: SlaFacts, now: Date): boolean {
  if (!t.dueAt) return false;
  if (t.resolvedAt) return t.resolvedAt.getTime() > t.dueAt.getTime();
  if (t.status === 'closed' || t.status === 'callback_pending') return false; // legacy rows without a resolution time
  return now.getTime() > t.dueAt.getTime();
}

/** Hours between two instants, one decimal (reports). */
export function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10;
}
