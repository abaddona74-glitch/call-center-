import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { overdueMs, overdueText, spanParts } from './overdue';

const t = ((key: string, o: Record<string, number>) =>
  `${key}:${Object.values(o).join(',')}`) as unknown as TFunction<'ticket'>;
const due = '2026-11-20T10:00:00.000Z';
const at = (iso: string) => new Date(iso).getTime();

describe('overdueMs', () => {
  it('runs to now while still with the region, stops at the resolution', () => {
    expect(overdueMs(due, null, at('2026-11-20T12:30:00Z'))).toBe(150 * 60_000);
    expect(overdueMs(due, '2026-11-21T10:00:00Z', at('2026-11-30T00:00:00Z'))).toBe(24 * 3_600_000);
  });

  it('null without a due date or when in time', () => {
    expect(overdueMs(null, null, at('2026-11-30T00:00:00Z'))).toBeNull();
    expect(overdueMs(due, null, at('2026-11-20T09:00:00Z'))).toBeNull();
    expect(overdueMs(due, '2026-11-20T09:59:00Z', at('2026-11-30T00:00:00Z'))).toBeNull();
  });
});

describe('overdue span', () => {
  it('whole days / hours / minutes, at least one minute', () => {
    expect(spanParts((2 * 1440 + 5 * 60 + 12) * 60_000)).toEqual({ d: 2, h: 5, m: 12 });
    expect(spanParts(59_999)).toEqual({ d: 0, h: 0, m: 1 });
  });

  it('the two largest units, zero units left out', () => {
    expect(overdueText((2 * 1440 + 5 * 60 + 12) * 60_000, t)).toBe('late.dh:2,5');
    expect(overdueText((3 * 1440 + 40) * 60_000, t)).toBe('late.d:3');
    expect(overdueText((5 * 60 + 12) * 60_000, t)).toBe('late.hm:5,12');
    expect(overdueText(2 * 3_600_000, t)).toBe('late.h:2');
    expect(overdueText(12 * 60_000, t)).toBe('late.m:12');
  });
});
