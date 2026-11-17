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
