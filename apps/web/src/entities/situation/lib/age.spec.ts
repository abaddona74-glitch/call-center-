import { describe, expect, it } from 'vitest';
import { formatAge } from './age';

describe('formatAge', () => {
  it('days and hours, hours and minutes, minutes', () => {
    expect(formatAge(2 * 86_400 + 3 * 3_600 + 59, 'uz')).toBe('2 kun 3 soat');
    expect(formatAge(2 * 86_400 + 3 * 3_600, 'ru')).toBe('2 д 3 ч');
    expect(formatAge(86_400 + 20 * 60, 'uz')).toBe('1 kun');
    expect(formatAge(3 * 3_600 + 5 * 60, 'uz')).toBe('3 soat 5 daq');
    expect(formatAge(3 * 3_600, 'ru')).toBe('3 ч');
    expect(formatAge(12 * 60 + 30, 'ru')).toBe('12 мин');
  });

  it('under a minute, and never negative (clock skew)', () => {
    expect(formatAge(59, 'uz')).toBe('<1 daq');
    expect(formatAge(-30, 'ru')).toBe('<1 мин');
  });
});
