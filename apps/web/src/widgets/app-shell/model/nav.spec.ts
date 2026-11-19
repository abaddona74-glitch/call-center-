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

  it('the guide stays for the other roles', () => {
    for (const role of ['operator', 'observer', 'superuser'] as const) expect(paths(role)).toContain('/guide');
  });
});
