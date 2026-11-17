import { describe, expect, it } from 'vitest';
import { formatUzPhone, normalizeUzPhone } from './phone.js';

describe('normalizeUzPhone', () => {
  it.each([
    ['+998 (90) 123-45-67', '901234567'],
    ['998901234567', '901234567'],
    ['8901234567', '901234567'],
    ['901234567', '901234567'],
    ['712020159', '712020159'],
    ['2020159', '2020159'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeUzPhone(input)).toBe(expected);
  });

  it('returns null for extensions and garbage', () => {
    expect(normalizeUzPhone('101')).toBeNull();
    expect(normalizeUzPhone('')).toBeNull();
    expect(normalizeUzPhone(null)).toBeNull();
    expect(normalizeUzPhone('abc')).toBeNull();
  });
});

describe('formatUzPhone', () => {
  it('formats national numbers', () => {
    expect(formatUzPhone('998901234567')).toBe('+998 (90) 123-45-67');
  });
});
