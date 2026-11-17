import { describe, expect, it } from 'vitest';
import { compareForBoard } from '../model/presence';
import { inGroup, operatorGroupOf } from './groups';

describe('operator groups', () => {
  it('splits main (1xx) and Zangiota (2xx+)', () => {
    expect(operatorGroupOf('101')).toBe('main');
    expect(operatorGroupOf('205')).toBe('secondary');
    expect(inGroup('205', 'all')).toBe(true);
    expect(inGroup('205', 'main')).toBe(false);
  });

  it('orders the board like legacy', () => {
    const ops = [
      { extension: '120', presence: 'offline' as const },
      { extension: '103', presence: 'talking' as const },
      { extension: '106', presence: 'idle' as const },
      { extension: '101', presence: 'idle' as const },
      { extension: '111', presence: 'ringing' as const },
      { extension: '119', presence: 'paused' as const },
    ];
    expect(ops.sort(compareForBoard).map((o) => o.extension)).toEqual(['111', '101', '106', '103', '119', '120']);
  });
});
