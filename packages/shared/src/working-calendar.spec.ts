import { describe, expect, it } from 'vitest';
import { HolidaySchema, WorkingCalendarInputSchema } from './working-calendar.js';

describe('HolidaySchema', () => {
  it.each(['2026-03-20', '03-21', '02-29', '2024-02-29'])('accepts %s', (h) => {
    expect(HolidaySchema.safeParse(h).success).toBe(true);
  });
  it.each(['2026-02-29', '13-01', '04-31', '2026-3-21', '21.03', ''])('rejects %s', (h) => {
    expect(HolidaySchema.safeParse(h).success).toBe(false);
  });
});

describe('WorkingCalendarInputSchema', () => {
  const ok = { days: [1, 2, 3, 4, 5], start: '08:00', end: '21:00', holidays: ['01-01', '2026-03-20'] };
  it('accepts a normal calendar', () => {
    expect(WorkingCalendarInputSchema.parse(ok)).toEqual(ok);
  });
  it('rejects end before start, duplicate days and holidays', () => {
    expect(WorkingCalendarInputSchema.safeParse({ ...ok, end: '07:00' }).success).toBe(false);
    expect(WorkingCalendarInputSchema.safeParse({ ...ok, days: [1, 1] }).success).toBe(false);
    expect(WorkingCalendarInputSchema.safeParse({ ...ok, holidays: ['01-01', '01-01'] }).success).toBe(false);
    expect(WorkingCalendarInputSchema.safeParse({ ...ok, days: [8] }).success).toBe(false);
  });
});
