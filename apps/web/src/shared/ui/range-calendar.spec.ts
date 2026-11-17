import { describe, expect, it } from 'vitest';
import { daysBetweenInclusive, fromDmy, toDmy } from './range-calendar';

describe('Kun.Oy.Yil dates', () => {
  it('round-trips and rejects impossible dates', () => {
    expect(toDmy('2026-11-07')).toBe('07.11.2026');
    expect(fromDmy('7.11.2026')).toBe('2026-11-07');
    expect(fromDmy('31.02.2026')).toBeNull();
    expect(fromDmy('2026-11-07')).toBeNull();
  });

  it('counts days inclusively', () => {
    expect(daysBetweenInclusive('2026-11-01', '2026-11-17')).toBe(17);
    expect(daysBetweenInclusive('2026-11-17', '2026-11-17')).toBe(1);
  });
});
