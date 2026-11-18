import { describe, expect, it } from 'vitest';
import { businessDate, dayBounds, formatBusinessDateTime, parseBusinessDateTime } from './working-calendar.js';

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
