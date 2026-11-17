import { describe, expect, it } from 'vitest';
import {
  type WorkingCalendar,
  businessDate,
  dayBounds,
  formatBusinessDateTime,
  isWorkingTime,
  parseBusinessDateTime,
} from './working-calendar.js';

const cal: WorkingCalendar = {
  timezone: 'Asia/Tashkent',
  workDays: [1, 2, 3, 4, 5],
  workStart: '08:00',
  workEnd: '21:00',
  holidays: ['2026-12-08'],
};

/** Tashkent is UTC+5 all year (no DST). */
const tashkent = (local: string) => new Date(`${local}+05:00`);

describe('isWorkingTime', () => {
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
    const saturdayShift: WorkingCalendar = {
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

describe('business dates', () => {
  it('maps late UTC evening to the next Tashkent day', () => {
    expect(businessDate(new Date('2026-11-17T20:00:00Z'), 'Asia/Tashkent')).toBe('2026-11-18');
  });

  it('day bounds are Tashkent midnight to midnight', () => {
    const { start, end } = dayBounds('2026-11-17', 'Asia/Tashkent');
    expect(start.toISOString()).toBe('2026-11-16T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-17T19:00:00.000Z');
  });

  it('rejects invalid dates', () => {
    expect(() => dayBounds('2026-13-40', 'Asia/Tashkent')).toThrow(RangeError);
  });
});

describe('parseBusinessDateTime', () => {
  it.each([
    ['2026-11-17 10:00:00', '2026-11-17T05:00:00.000Z'],
    ['2026/11/17 10:00:00', '2026-11-17T05:00:00.000Z'],
    ['2026-11-17T10:00:00', '2026-11-17T05:00:00.000Z'],
    ['2026-11-17T10:00:00Z', '2026-11-17T10:00:00.000Z'],
    ['2026-11-17T10:00:00+03:00', '2026-11-17T07:00:00.000Z'],
  ])('%s → %s', (raw, iso) => {
    expect(parseBusinessDateTime(raw, 'Asia/Tashkent')?.toISOString()).toBe(iso);
  });

  it.each(['', 'yesterday', '17.11.2026', '2026-11-17 25:00:00'])('%j → null', (raw) => {
    expect(parseBusinessDateTime(raw, 'Asia/Tashkent')).toBeNull();
  });

  it('formats back to PBX wall-clock text', () => {
    expect(formatBusinessDateTime(new Date('2026-11-17T05:00:00Z'), 'Asia/Tashkent')).toBe('2026-11-17 10:00:00');
  });
});

describe('owner decision: Mon–Fri 08:00–21:00 Tashkent + holiday list', () => {
  const owner: WorkingCalendar = { ...cal, holidays: ['2027-01-01', '2027-03-08', '2027-03-21'] };

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
