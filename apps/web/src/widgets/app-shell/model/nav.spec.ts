import { type Role, type SessionUser, permissionsFor } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { homePath, visibleNavItems } from './nav';

const user = (role: Role): SessionUser => ({
  id: 1,
  username: role,
  role,
  extension: null,
  email: null,
  permissions: permissionsFor(role, null),
});

const paths = (role: Role) => visibleNavItems(user(role)).map((item) => item.to);

describe('sidebar by role', () => {
  it('"Mas’ul" (executive): tickets, ticket reports and the profile — nothing else', () => {
    expect(paths('executive')).toEqual(['/tickets', '/tickets/reports', '/profile']);
  });

  it('the executive lands on the tickets; dashboard users stay on /', () => {
    expect(homePath(user('executive'))).toBe('/tickets');
    expect(paths('operator')[0]).toBe('/');
  });

  it('the guide stays for operators and the superuser', () => {
    for (const role of ['operator', 'superuser'] as const) expect(paths(role)).toContain('/guide');
  });

  it('observer: the live situation board, the overview dashboard and the profile, landing on the board (owner, 19.11.2026)', () => {
    expect(paths('observer')).toEqual(['/situation', '/overview', '/profile']);
    expect(homePath(user('observer'))).toBe('/situation');
    expect(paths('executive')).not.toContain('/overview');
    expect(paths('executive')).not.toContain('/situation');
    expect(paths('operator')).not.toContain('/situation');
    expect(paths('superuser')).toContain('/overview');
    // the superuser keeps the live dashboard on `/` and gets the board as its next item
    expect(paths('superuser').slice(0, 3)).toEqual(['/', '/situation', '/overview']);
  });
});
