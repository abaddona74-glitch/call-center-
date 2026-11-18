import { addDays, datesBetween, isoWeekday, parseWall, wallToIso } from './business-time.js';
import { WorkingCalendar } from './working-calendar.js';

const calendar = new WorkingCalendar({ days: [1, 2, 3, 4, 5], start: '08:00', end: '21:00' });

describe('WorkingCalendar', () => {
  it('is half-open: 08:00:00 is in, 21:00:00 is out', () => {
    expect(calendar.isWorkingWall('2026-11-17 08:00:00')).toBe(true); // Tuesday
    expect(calendar.isWorkingWall('2026-11-17 07:59:59')).toBe(false);
    expect(calendar.isWorkingWall('2026-11-17 20:59:59')).toBe(true);
    expect(calendar.isWorkingWall('2026-11-17 21:00:00')).toBe(false);
  });

  it('excludes weekends', () => {
    expect(calendar.isWorkingWall('2026-11-14 10:00:00')).toBe(false); // Saturday
    expect(calendar.isWorkingWall('2026-11-15 10:00:00')).toBe(false); // Sunday
    expect(calendar.isWorkingDay('2026-11-16')).toBe(true); // Monday
  });

  it('lists the hours that overlap working time', () => {
    expect(calendar.workingHours()).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(new WorkingCalendar({ days: [1], start: '08:30', end: '09:15' }).workingHours()).toEqual([8, 9]);
  });

  it('can include Saturday when configured', () => {
    const sixDays = new WorkingCalendar({ days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '18:00' });
    expect(sixDays.isWorkingWall('2026-11-14 10:00:00')).toBe(true);
  });

  it('treats configured holidays as non-working days (yearly MM-DD and one-off YYYY-MM-DD)', () => {
    const withHolidays = new WorkingCalendar({
      days: [1, 2, 3, 4, 5],
      start: '08:00',
      end: '21:00',
      holidays: ['01-01', '2026-11-18'],
    });
    expect(withHolidays.isWorkingDay('2026-11-18')).toBe(false); // Wednesday, one-off holiday
    expect(withHolidays.isWorkingDay('2027-11-18')).toBe(true); // one-off: other years are normal
    expect(withHolidays.isWorkingWall('2027-01-01 10:00:00')).toBe(false); // Friday, yearly holiday
    expect(withHolidays.isWorkingWall('2026-11-17 10:00:00')).toBe(true);
    expect(withHolidays.info().holidays).toEqual(['01-01', '2026-11-18']);
  });

  it('rejects an empty interval', () => {
    expect(() => new WorkingCalendar({ days: [1], start: '10:00', end: '09:00' })).toThrow();
  });
});

describe('business time helpers', () => {
  it('parses Tashkent wall time to an instant (UTC+5)', () => {
    const w = parseWall('2026-11-17 10:00:05');
    expect(w.date).toBe('2026-11-17');
    expect(w.hour).toBe(10);
    expect(w.secondOfDay).toBe(36005);
    expect(new Date(w.epochMs).toISOString()).toBe('2026-11-17T05:00:05.000Z');
    expect(wallToIso('2026-11-17 10:00:05')).toBe('2026-11-17T10:00:05+05:00');
  });

  it('does date arithmetic on calendar dates', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(datesBetween('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
    expect(isoWeekday('2026-11-16')).toBe(1);
    expect(isoWeekday('2026-11-22')).toBe(7);
  });
});

// --- moved from the callbacks module: one calendar for stats, callbacks and tickets (2026-11-18) ---

interface LegacyShape {
  timezone: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  holidays: string[];
}
const cal: LegacyShape = {
  timezone: 'Asia/Tashkent',
  workDays: [1, 2, 3, 4, 5],
  workStart: '08:00',
  workEnd: '21:00',
  holidays: ['2026-12-08'],
};

/** Tashkent is UTC+5 all year (no DST). */
const tashkent = (local: string) => new Date(`${local}+05:00`);
const isWorkingTime = (at: Date, c: LegacyShape) =>
  new WorkingCalendar({ days: c.workDays, start: c.workStart, end: c.workEnd, holidays: c.holidays }).isWorkingInstant(at);

describe('isWorkingInstant', () => {
  it.each([
    ['2026-11-17T08:00:00', true], // Tuesday, opening second
    ['2026-11-17T07:59:59', false],
    ['2026-11-17T12:30:00', true],
    ['2026-11-17T20:59:59', true],
    ['2026-11-17T21:00:00', false], // half-open: closing second is after hours (legacy counted it)
    ['2026-11-17T23:10:00', false],
    ['2026-11-21T10:00:00', false], // Saturday (legacy B1: weekends were working time)
    ['2026-11-22T10:00:00', false], // Sunday
    ['2026-12-08T10:00:00', false], // configured holiday
    ['2026-12-09T10:00:00', true],
  ])('%s Tashkent → %s', (local, expected) => {
    expect(isWorkingTime(tashkent(local), cal)).toBe(expected);
  });

  it('uses the business timezone, not the host timezone (legacy B2)', () => {
    // 03:30 UTC = 08:30 in Tashkent → working; in UTC it would look like night.
    expect(isWorkingTime(new Date('2026-11-17T03:30:00Z'), cal)).toBe(true);
    // 16:30 UTC = 21:30 Tashkent → after hours although 16:30 looks like a working hour in UTC.
    expect(isWorkingTime(new Date('2026-11-17T16:30:00Z'), cal)).toBe(false);
  });

  it('respects a configured weekend working day and custom hours', () => {
    const saturdayShift: LegacyShape = {
      ...cal,
      workDays: [1, 2, 3, 4, 5, 6],
      workStart: '09:00',
      workEnd: '18:00',
    };
    expect(isWorkingTime(tashkent('2026-11-21T09:00:00'), saturdayShift)).toBe(true);
    expect(isWorkingTime(tashkent('2026-11-21T08:59:00'), saturdayShift)).toBe(false);
    expect(isWorkingTime(tashkent('2026-11-21T18:00:00'), saturdayShift)).toBe(false);
  });

  it('treats an empty week as always closed', () => {
    expect(isWorkingTime(tashkent('2026-11-17T12:00:00'), { ...cal, workDays: [] })).toBe(false);
  });
});

describe('owner decision: Mon–Fri 08:00–21:00 Tashkent + holiday list', () => {
  const owner: LegacyShape = { ...cal, holidays: ['2027-01-01', '2027-03-08', '2027-03-21'] };

  it.each([
    ['2027-01-01T10:00:00', false, 'New Year (Friday) is a holiday'],
    ['2027-01-04T10:00:00', true, 'next Monday is working'],
    ['2027-03-08T09:00:00', false, "Women's Day (Monday)"],
    ['2027-03-21T12:00:00', false, 'Navruz on a Sunday stays closed'],
    ['2027-03-20T12:00:00', false, 'Saturday'],
    ['2027-03-19T20:59:00', true, 'Friday just before closing'],
    ['2027-03-19T21:00:00', false, 'Friday at closing time'],
  ])('%s → %s (%s)', (local, expected) => {
    expect(isWorkingTime(tashkent(local), owner)).toBe(expected);
  });

  it('a holiday is matched by the Tashkent date, not the UTC date', () => {
    // 2027-01-01 00:30 Tashkent = 2026-12-31 19:30 UTC: still the holiday in Tashkent.
    expect(isWorkingTime(new Date('2026-12-31T19:30:00Z'), { ...owner, workStart: '00:00' })).toBe(false);
    // 2026-12-31 08:30 Tashkent is a normal Thursday.
    expect(isWorkingTime(new Date('2026-12-31T03:30:00Z'), owner)).toBe(true);
  });
});
