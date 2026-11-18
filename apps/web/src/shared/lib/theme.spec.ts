import { describe, expect, it } from 'vitest';
import initScript from '../../../public/theme-init.js?raw';
import { THEME_STORAGE_KEY, THEMES, accentText } from './theme';

describe('theme', () => {
  it('pre-paint script reads the same key and sets the same classes', () => {
    expect(initScript).toContain(`'${THEME_STORAGE_KEY}'`);
    for (const theme of THEMES) expect(initScript).toContain(`'${theme}'`);
  });

  it('accent text keeps the color as is in dark (shade 0%) and darkens it toward ink in light', () => {
    expect(accentText('#f59e0b')).toBe('color-mix(in oklab, #f59e0b, var(--ink) var(--shade))');
  });
});
