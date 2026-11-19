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

  it('observer: the overview dashboard, the staff KPI page and the profile only, landing on the overview (owner, 19.11.2026)', () => {
    expect(paths('observer')).toEqual(['/overview', '/kpi', '/profile']);
    expect(homePath(user('observer'))).toBe('/overview');
    for (const role of ['executive', 'operator'] as const) {
      expect(paths(role)).not.toContain('/overview');
      expect(paths(role)).not.toContain('/kpi');
    }
    expect(paths('superuser')).toEqual(expect.arrayContaining(['/overview', '/kpi']));
  });
});
