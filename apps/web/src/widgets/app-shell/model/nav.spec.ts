import { type Role, type SessionUser, permissionsFor } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { activeNavPath, homePath, isNavGroup, visibleNavEntries, visibleNavItems } from './nav';

const user = (role: Role): SessionUser => ({
  id: 1,
  username: role,
  role,
  extension: null,
  email: null,
  permissions: permissionsFor(role),
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

  it('observer: the live situation board, the overview dashboard, the staff KPI page and the profile, landing on the board (owner, 19.11.2026)', () => {
    expect(paths('observer')).toEqual(['/situation', '/overview', '/kpi', '/profile']);
    expect(homePath(user('observer'))).toBe('/situation');
    for (const role of ['executive', 'operator'] as const) {
      for (const page of ['/situation', '/overview', '/kpi']) expect(paths(role)).not.toContain(page);
    }
    // the superuser keeps the live dashboard on `/`, then the board, the overview and the staff KPI page
    expect(paths('superuser').slice(0, 4)).toEqual(['/', '/situation', '/overview', '/kpi']);
  });
});

describe('"Sozlamalar" group', () => {
  const settings = (u: SessionUser) => visibleNavEntries(u).find((e) => isNavGroup(e) && e.id === 'settings');

  it('the superuser gets the four settings pages folded under one header', () => {
    const group = settings(user('superuser'));
    expect(group && isNavGroup(group) ? group.children.map((item) => item.to) : null).toEqual([
      '/settings',
      '/settings/blacklist',
      '/settings/calendar',
      '/settings/tickets',
    ]);
  });

  it('roles without settings get no group at all', () => {
    for (const role of ['operator', 'observer', 'executive'] as const) {
      expect(settings(user(role))).toBeUndefined();
      expect(paths(role).some((to) => to.startsWith('/settings'))).toBe(false);
    }
  });

  it('a group left with one page shows as that plain page', () => {
    const onlyBlacklist: SessionUser = { ...user('observer'), permissions: ['blacklist.manage'] };
    expect(settings(onlyBlacklist)).toBeUndefined();
    expect(visibleNavEntries(onlyBlacklist).map((e) => (isNavGroup(e) ? e.id : e.to))).toEqual([
      '/settings/blacklist',
      '/profile',
    ]);
  });
});

describe('activeNavPath', () => {
  const all = visibleNavItems(user('superuser')).map((item) => item.to);

  it('lights only the most specific item', () => {
    expect(activeNavPath(all, '/settings/blacklist')).toBe('/settings/blacklist');
    expect(activeNavPath(all, '/settings/calendar')).toBe('/settings/calendar');
    expect(activeNavPath(all, '/settings/users')).toBe('/settings');
    expect(activeNavPath(all, '/tickets/reports')).toBe('/tickets/reports');
    expect(activeNavPath(all, '/tickets/42')).toBe('/tickets');
  });

  it('"/" is the dashboard only, and look-alike prefixes do not match', () => {
    expect(activeNavPath(all, '/')).toBe('/');
    expect(activeNavPath(all, '/nowhere')).toBeUndefined();
    expect(activeNavPath(all, '/settingsx')).toBeUndefined();
  });
});
