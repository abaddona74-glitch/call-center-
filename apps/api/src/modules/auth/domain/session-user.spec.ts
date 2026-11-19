import { PERMISSIONS, ROLE_PERMISSIONS, can, hasPermission } from '@cc/shared';
import { buildSessionUser, parseGroupFlags } from './session-user.js';

const base = { id: 1, username: 'u', extension: '205', email: null };
const restricted = {
  canSeeContacts: false,
  canEditContacts: false,
  canUseRemoteDesktop: false,
  canRequestHelp: false,
  canUseTools: false,
};

describe('role permissions', () => {
  it('superuser has everything; executive ("Mas’ul") only processes the tickets of its regions', () => {
    expect([...ROLE_PERMISSIONS.superuser].sort()).toEqual([...PERMISSIONS].sort());
    // owner decision 2026-11-19: tickets, ticket reports and the profile — nothing else
    expect(ROLE_PERMISSIONS.executive).toEqual(['tickets.process']);
  });

  it('the guide is for operators and the superuser (not "Mas’ul", not observers)', () => {
    expect(can({ role: 'operator' }, 'guide.view')).toBe(true);
    expect(can({ role: 'observer' }, 'guide.view')).toBe(false);
    expect(can({ role: 'superuser' }, 'guide.view')).toBe(true);
    expect(can({ role: 'executive' }, 'guide.view')).toBe(false);
  });

  it('observer is read-only', () => {
    for (const p of ROLE_PERMISSIONS.observer) expect(p).toMatch(/\.(view|viewAll|listen)$/);
  });

  it('the overview dashboard: observer sees only it, the superuser too, executives and operators not (owner, 19.11.2026)', () => {
    expect(ROLE_PERMISSIONS.observer).toEqual(['overview.view']);
    expect(can({ role: 'superuser' }, 'overview.view')).toBe(true);
    expect(can({ role: 'executive' }, 'overview.view')).toBe(false);
    expect(can({ role: 'operator' }, 'overview.view')).toBe(false);
  });

  it('tickets: operators create and call back, executives process, observers nothing, superuser manages directories', () => {
    const op = { role: 'operator' as const };
    const exec = { role: 'executive' as const };
    const obs = { role: 'observer' as const };
    const su = { role: 'superuser' as const };
    expect([can(op, 'tickets.create'), can(op, 'tickets.callback'), can(op, 'tickets.process')]).toEqual([
      true,
      true,
      false,
    ]);
    expect([can(exec, 'tickets.process'), can(exec, 'tickets.create'), can(exec, 'tickets.viewAll')]).toEqual([
      true,
      false,
      false,
    ]);
    expect([can(obs, 'tickets.viewAll'), can(obs, 'tickets.process'), can(obs, 'tickets.callback')]).toEqual([
      false,
      false,
      false,
    ]);
    expect(can(su, 'tickets.directories.manage')).toBe(true);
    expect(can(exec, 'tickets.directories.manage')).toBe(false);
    // the session's own list wins over the role map
    expect(can({ role: 'operator', permissions: ['monitor.view'] }, 'tickets.create')).toBe(false);
  });
});

describe('session user permissions', () => {
  it('operators lose what their group switches off', () => {
    const u = buildSessionUser({ ...base, role: 'operator', groupId: 2, groupPermissions: restricted });
    expect(u.permissions).not.toContain('contacts.view');
    expect(u.permissions).not.toContain('tools.use');
    expect(u.permissions).toContain('tickets.create');
    expect(hasPermission(u, 'canSeeContacts')).toBe(false); // group-flag alias still works
  });

  it('groups never restrict other roles', () => {
    const u = buildSessionUser({ ...base, role: 'executive', groupId: 2, groupPermissions: restricted });
    expect(u.permissions).toEqual([...ROLE_PERMISSIONS.executive]);
  });

  it('operators without a group get the full operator set (legacy main group)', () => {
    const u = buildSessionUser({ ...base, role: 'operator', groupId: null, groupPermissions: null });
    expect(u.permissions).toEqual([...ROLE_PERMISSIONS.operator]);
  });

  it('missing flags in stored groups default to allowed', () => {
    expect(parseGroupFlags({ canSeeContacts: false })).toMatchObject({ canSeeContacts: false, canUseTools: true });
    expect(parseGroupFlags('garbage').canSeeContacts).toBe(true);
  });

  it('works for session users without the optional fields', () => {
    expect(hasPermission({ role: 'operator' }, 'contacts.view')).toBe(true);
    expect(hasPermission({ role: 'observer' }, 'callbacks.manage')).toBe(false);
  });

  it('carries the forced password change and impersonation info', () => {
    const u = buildSessionUser(
      { ...base, role: 'operator', groupId: null, groupPermissions: null, mustChangePassword: true },
      { by: { id: 9, username: 'boss' }, expiresAt: new Date('2026-11-17T10:00:00Z') },
    );
    expect(u.mustChangePassword).toBe(true);
    expect(u.impersonation).toEqual({ by: { id: 9, username: 'boss' }, expiresAt: '2026-11-17T10:00:00.000Z' });
  });
});
