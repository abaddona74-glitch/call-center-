import { describe, expect, it } from 'vitest';
import { astdbFamily, astdbKeys, astdbValue } from './astdb.js';

describe('astdbFamily', () => {
  it('maps scopes to families', () => {
    expect(astdbFamily('global', null)).toBe('blacklist');
    expect(astdbFamily('operator', '114')).toBe('blacklist_114');
  });

  it('refuses operator scope without a valid extension', () => {
    expect(() => astdbFamily('operator', null)).toThrow(RangeError);
    expect(() => astdbFamily('operator', '11 4')).toThrow(RangeError);
  });
});

describe('astdbKeys', () => {
  it('writes both caller-id forms for national mobile numbers', () => {
    expect(astdbKeys('901234567')).toEqual(['901234567', '998901234567']);
  });

  it('keeps other lengths as they are', () => {
    expect(astdbKeys('2020159')).toEqual(['2020159']);
  });

  it('rejects anything that is not digits', () => {
    expect(() => astdbKeys('90123456a')).toThrow(RangeError);
    expect(() => astdbKeys('12')).toThrow(RangeError);
  });
});

describe('astdbValue', () => {
  it('keeps letters (any script), digits and simple separators', () => {
    expect(astdbValue('Spam: qo‘ng‘iroq (2026-11-17)')).toBe('Spam: qongiroq (2026-11-17)');
    expect(astdbValue('Хулиган, звонит ночью')).toBe('Хулиган, звонит ночью');
  });

  it('strips injection characters and line breaks', () => {
    expect(astdbValue('x\r\nAction: Originate\r\n"; rm -rf /')).toBe('x Action: Originate rm -rf');
  });

  it('falls back to "1" and truncates', () => {
    expect(astdbValue('  "\'`  ')).toBe('1');
    expect(astdbValue('a'.repeat(300))).toHaveLength(100);
  });
});
