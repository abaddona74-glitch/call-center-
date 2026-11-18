import { describe, expect, it } from 'vitest';
import {
  EXCLUDED_OPERATORS_MAX,
  ExcludedOperatorsInputSchema,
  compareExtensions,
  normalizeExtensions,
} from './excluded-operators.js';

describe('ExcludedOperatorsInputSchema', () => {
  it('accepts extensions of 2–6 digits and trims them', () => {
    expect(ExcludedOperatorsInputSchema.parse({ extensions: [' 118', '1111', '99', '123456'] })).toEqual({
      extensions: ['118', '1111', '99', '123456'],
    });
    expect(ExcludedOperatorsInputSchema.parse({ extensions: [] })).toEqual({ extensions: [] });
  });

  it('rejects anything that is not an extension', () => {
    for (const bad of ['1', '1234567', '11a', '', 'SIP/118', '+998901234567', '1 18']) {
      expect(ExcludedOperatorsInputSchema.safeParse({ extensions: [bad] }).success, bad).toBe(false);
    }
    expect(ExcludedOperatorsInputSchema.safeParse({ extensions: '118' }).success).toBe(false);
    expect(ExcludedOperatorsInputSchema.safeParse({}).success).toBe(false);
  });

  it('limits the list size', () => {
    const many = Array.from({ length: EXCLUDED_OPERATORS_MAX + 1 }, (_, i) => String(100 + i));
    expect(ExcludedOperatorsInputSchema.safeParse({ extensions: many }).success).toBe(false);
  });
});

describe('normalizeExtensions', () => {
  it('drops duplicates and blanks and sorts by number', () => {
    expect(normalizeExtensions(['1111', '118', ' 118 ', '', '99', '205'])).toEqual(['99', '118', '205', '1111']);
  });

  it('compares numerically, then as text', () => {
    expect(['101', '99', '1000', '0101'].sort(compareExtensions)).toEqual(['99', '0101', '101', '1000']);
  });
});
