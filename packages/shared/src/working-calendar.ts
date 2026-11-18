import { z } from 'zod';

/**
 * The one working calendar of the call center (owner decision 2026-11-18): working weekdays, hours and
 * public holidays, Asia/Tashkent. Stored in the database, edited by `settings.manage` on one screen and
 * used by statistics ("working hours" scope), callbacks ("after hours") and ticket deadlines.
 */

const HhMmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

function isRealDate(year: number, month: number, day: number): boolean {
  const t = new Date(Date.UTC(year, month - 1, day));
  return t.getUTCFullYear() === year && t.getUTCMonth() === month - 1 && t.getUTCDate() === day;
}

/** "YYYY-MM-DD" (one date, e.g. a movable holiday) or "MM-DD" (every year). */
export const HolidaySchema = z.string().refine((h) => {
  const one = /^(\d{4})-(\d{2})-(\d{2})$/.exec(h);
  if (one) return isRealDate(Number(one[1]), Number(one[2]), Number(one[3]));
  const yearly = /^(\d{2})-(\d{2})$/.exec(h);
  // 2024 is a leap year, so 02-29 is accepted as a yearly date
  return Boolean(yearly && isRealDate(2024, Number(yearly[1]), Number(yearly[2])));
}, 'Expected YYYY-MM-DD or MM-DD');

export const WorkingCalendarInputSchema = z
  .object({
    /** ISO weekdays: 1 = Monday … 7 = Sunday. */
    days: z
      .array(z.number().int().min(1).max(7))
      .max(7)
      .refine((d) => new Set(d).size === d.length, 'Duplicate weekday'),
    /** "HH:mm", inclusive. */
    start: HhMmSchema,
    /** "HH:mm", exclusive. */
    end: HhMmSchema,
    holidays: z
      .array(HolidaySchema)
      .max(400)
      .refine((d) => new Set(d).size === d.length, 'Duplicate holiday'),
  })
  .refine((c) => c.start < c.end, { message: 'start must be before end', path: ['end'] });
export type WorkingCalendarInput = z.infer<typeof WorkingCalendarInputSchema>;

/** The calendar as the server applies it. */
export const WorkingCalendarSchema = z.object({
  timezone: z.string(),
  days: z.array(z.number().int()),
  start: z.string(),
  end: z.string(),
  /** "MM-DD" (every year) or "YYYY-MM-DD", sorted. */
  holidays: z.array(z.string()),
});
export type WorkingCalendarInfo = z.infer<typeof WorkingCalendarSchema>;

export const DEFAULT_WORKING_CALENDAR: WorkingCalendarInput = {
  days: [1, 2, 3, 4, 5],
  start: '08:00',
  end: '21:00',
  holidays: [],
};
