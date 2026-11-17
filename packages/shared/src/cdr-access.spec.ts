import { describe, expect, it } from 'vitest';
import { canAccessCdr } from './cdr-access.js';

describe('canAccessCdr', () => {
  it('keeps legacy parity: operators read call lists and the operator table, nothing else', () => {
    const operator = { role: 'operator' as const };
    expect(canAccessCdr(operator, 'calls.read')).toBe(true);
    expect(canAccessCdr(operator, 'stats.operators')).toBe(true);
    expect(canAccessCdr(operator, 'calls.recordings')).toBe(false);
    expect(canAccessCdr(operator, 'stats.read')).toBe(false);
    expect(canAccessCdr(operator, 'reports.export')).toBe(false);
    expect(canAccessCdr({ role: 'superuser' }, 'reports.export')).toBe(true);
  });
});
