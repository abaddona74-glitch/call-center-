import type { OverviewTicketTotals } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { deadlineSplit, listDateTime, percentOf } from './format';

describe('ticket overview format', () => {
  it('percentOf', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(5, 0)).toBe(0);
  });

  it('deadlineSplit: in time = resolved − resolved late; still overdue = open after due', () => {
    const t = { done: 10, rejected: 2, overdueLate: 3, overdueOpen: 4 } as OverviewTicketTotals;
    expect(deadlineSplit(t)).toEqual({ onTime: 9, late: 3, stillOverdue: 4 });
  });

  it('listDateTime', () => {
    const wall = () => '2026-11-19 09:05:07';
    expect(listDateTime('2026-11-19T04:05:07Z', wall)).toBe('19.11.2026 09:05');
    expect(listDateTime(null, wall)).toBe('—');
  });
});
