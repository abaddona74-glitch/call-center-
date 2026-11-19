import type { OverviewTicketTotals } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { deadlineSplit, lateBy, percentOf } from './format';

describe('ticket overview format', () => {
  it('percentOf', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(5, 0)).toBe(0);
  });

  it('lateBy: days from a day on, hours below', () => {
    const now = new Date('2026-11-19T12:00:00Z');
    expect(lateBy('2026-11-16T10:00:00Z', now)).toEqual({ unit: 'days', n: 3 });
    expect(lateBy('2026-11-18T12:00:00Z', now)).toEqual({ unit: 'days', n: 1 });
    expect(lateBy('2026-11-19T07:30:00Z', now)).toEqual({ unit: 'hours', n: 4 });
    expect(lateBy('2026-11-19T11:59:00Z', now)).toEqual({ unit: 'hours', n: 1 });
  });

  it('deadlineSplit: in time = resolved − resolved late; still overdue = open after due', () => {
    const t = { done: 10, rejected: 2, overdueLate: 3, overdueOpen: 4 } as OverviewTicketTotals;
    expect(deadlineSplit(t)).toEqual({ onTime: 9, late: 3, stillOverdue: 4 });
  });
});
