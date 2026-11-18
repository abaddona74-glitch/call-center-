import { describe, expect, it } from 'vitest';
import { WorkingCalendar } from '../../../common/time/working-calendar.js';
import { hoursBetween, isCallbackOverdue, isOverdue, slaDueAt } from './sla.js';

const cal = new WorkingCalendar({
  days: [1, 2, 3, 4, 5],
  start: '08:00',
  end: '21:00',
  holidays: ['01-01', '2026-11-19'],
});
// Tashkent is UTC+5 all year.
const at = (local: string) => new Date(`${local}+05:00`);

describe('slaDueAt (3 working days, Mon–Fri, holidays, Asia/Tashkent)', () => {
  it('counts working days and keeps the time of day', () => {
    // Mon 2026-11-23 10:00 → Thu 2026-11-26 10:00
    expect(slaDueAt(at('2026-11-23T10:00:00'), 3, cal)).toEqual(at('2026-11-26T10:00:00'));
  });

  it('skips weekends', () => {
    // Thu 2026-11-26 15:30 → Fri, Mon, Tue → Tue 2026-12-01 15:30
    expect(slaDueAt(at('2026-11-26T15:30:00'), 3, cal)).toEqual(at('2026-12-01T15:30:00'));
  });

  it('skips holidays (one-off and yearly)', () => {
    // Tue 2026-11-17 → Wed 18, (Thu 19 holiday), Fri 20, Mon 23
    expect(slaDueAt(at('2026-11-17T09:00:00'), 3, cal)).toEqual(at('2026-11-23T09:00:00'));
    // Wed 2026-12-30 → Thu 31, (Fri 1 Jan holiday), Mon 4, Tue 5
    expect(slaDueAt(at('2026-12-30T12:00:00'), 3, cal)).toEqual(at('2027-01-05T12:00:00'));
  });

  it('a ticket opened on a weekend starts counting on the next working day', () => {
    // Sat 2026-11-21 11:00 → starts Mon 00:00 → Thu 2026-11-26 00:00
    expect(slaDueAt(at('2026-11-21T11:00:00'), 3, cal)).toEqual(at('2026-11-26T00:00:00'));
  });

  it('uses the business timezone, not UTC dates', () => {
    // Fri 2026-11-27 23:30 Tashkent = 18:30 UTC Friday → Mon, Tue, Wed 23:30
    expect(slaDueAt(new Date('2026-11-27T18:30:00Z'), 3, cal)).toEqual(at('2026-12-02T23:30:00'));
    // Mon 00:30 Tashkent = Sun 19:30 UTC: already Monday in Tashkent
    expect(slaDueAt(new Date('2026-11-22T19:30:00Z'), 1, cal)).toEqual(at('2026-11-24T00:30:00'));
  });

  it('is configurable and validated', () => {
    expect(slaDueAt(at('2026-11-23T10:00:00'), 1, cal)).toEqual(at('2026-11-24T10:00:00'));
    expect(() => slaDueAt(new Date(), 0, cal)).toThrow(RangeError);
  });
});

describe('isOverdue', () => {
  const dueAt = at('2026-11-26T10:00:00');
  it('open tickets after the due time', () => {
    expect(isOverdue({ status: 'in_progress', dueAt, resolvedAt: null }, at('2026-11-26T10:00:01'))).toBe(true);
    expect(isOverdue({ status: 'new', dueAt, resolvedAt: null }, at('2026-11-26T09:59:59'))).toBe(false);
  });
  it('resolved tickets by their resolution time, forever', () => {
    expect(
      isOverdue({ status: 'closed', dueAt, resolvedAt: at('2026-11-27T08:00:00') }, at('2026-11-20T00:00:00')),
    ).toBe(true);
    expect(
      isOverdue(
        { status: 'callback_pending', dueAt, resolvedAt: at('2026-11-25T08:00:00') },
        at('2027-01-01T00:00:00'),
      ),
    ).toBe(false);
  });
  it('legacy tickets without due date or resolution time are never overdue', () => {
    expect(isOverdue({ status: 'new', dueAt: null, resolvedAt: null }, new Date())).toBe(false);
    expect(isOverdue({ status: 'closed', dueAt, resolvedAt: null }, at('2027-01-01T00:00:00'))).toBe(false);
  });
  it('hoursBetween', () => {
    expect(hoursBetween(at('2026-11-23T10:00:00'), at('2026-11-24T22:30:00'))).toBe(36.5);
  });
});

describe('callback SLA', () => {
  // done on Wed 18.11 10:00; Thu 19.11 is a holiday → 1 working day = Fri 20.11 10:00
  const callbackDueAt = slaDueAt(at('2026-11-18T10:00:00'), 1, cal);
  it('uses the same working calendar', () => {
    expect(callbackDueAt).toEqual(at('2026-11-20T10:00:00'));
  });
  it('waiting in the queue past the due time is overdue', () => {
    expect(isCallbackOverdue({ callbackDueAt, closedAt: null }, at('2026-11-20T09:59:00'))).toBe(false);
    expect(isCallbackOverdue({ callbackDueAt, closedAt: null }, at('2026-11-20T10:01:00'))).toBe(true);
  });
  it('closed tickets by their closing time, forever', () => {
    const late = { callbackDueAt, closedAt: at('2026-11-20T11:00:00') };
    const inTime = { callbackDueAt, closedAt: at('2026-11-20T09:00:00') };
    expect(isCallbackOverdue(late, at('2026-11-20T11:00:00'))).toBe(true);
    expect(isCallbackOverdue(inTime, at('2027-01-01T00:00:00'))).toBe(false);
  });
  it('no callback due time (still with the region, legacy) is never overdue', () => {
    expect(isCallbackOverdue({ callbackDueAt: null, closedAt: null }, at('2027-01-01T00:00:00'))).toBe(false);
  });
});
