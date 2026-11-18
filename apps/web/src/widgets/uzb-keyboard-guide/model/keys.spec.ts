import { describe, expect, it } from 'vitest';
import { KEYBOARD_PACKAGE, KEY_COMBOS, QUICK_CHARS, insertAt } from './keys';

describe('insertAt', () => {
  it('inserts at the caret and moves the caret after the character', () => {
    expect(insertAt('olam', 1, 1, 'ş')).toEqual({ text: 'oşlam', caret: 2 });
  });

  it('replaces the selection', () => {
    expect(insertAt('sahar', 0, 1, 'ş')).toEqual({ text: 'şahar', caret: 1 });
  });

  it('appends when there is no selection info and clamps out-of-range positions', () => {
    expect(insertAt('abc', undefined, undefined, 'ğ')).toEqual({ text: 'abcğ', caret: 4 });
    expect(insertAt('abc', 10, 12, 'ö')).toEqual({ text: 'abcö', caret: 4 });
  });
});

describe('cheat sheet', () => {
  it('has the nine legacy characters in order', () => {
    expect(QUICK_CHARS.join('')).toBe('şŞçÇğĞöÖʼ');
    expect(KEY_COMBOS.filter((c) => c.shift).map((c) => c.char)).toEqual(['Ş', 'Ç', 'Ğ', 'Ö']);
  });

  it('downloads the file that actually exists (not legacy uzb2026-setup.zip)', () => {
    expect(KEYBOARD_PACKAGE).toBe('uzb2026-klaviatura.zip');
  });
});
