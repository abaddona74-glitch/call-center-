import { PERMISSIONS, ROLE_PERMISSIONS, hasPermission, hasRoleAtLeast } from '@cc/shared';
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
  it('superuser has everything; executive everything except user/session/security management', () => {
    expect([...ROLE_PERMISSIONS.superuser].sort()).toEqual([...PERMISSIONS].sort());
    for (const p of ['users.manage', 'sessions.manage', 'security.manage', 'impersonate'] as const) {
      expect(ROLE_PERMISSIONS.executive).not.toContain(p);
    }
    expect(ROLE_PERMISSIONS.executive).toEqual(
      expect.arrayContaining(['settings.manage', 'actions.call', 'reports.view']),
    );
  });

  it('observer is read-only', () => {
    for (const p of ROLE_PERMISSIONS.observer) expect(p).toMatch(/\.(view|listen)$/);
  });

  it('keeps the old minimum-level checks working (admin = executive level)', () => {
    expect(hasRoleAtLeast('executive', 'admin')).toBe(true);
    expect(hasRoleAtLeast('superuser', 'admin')).toBe(true);
    expect(hasRoleAtLeast('observer', 'admin')).toBe(false);
    expect(hasRoleAtLeast('operator', 'operator')).toBe(true);
    expect(hasRoleAtLeast('operator', 'observer')).toBe(false);
  });
});

describe('session user permissions', () => {
  it('operators lose what their group switches off', () => {
    const u = buildSessionUser({ ...base, role: 'operator', groupId: 2, groupPermissions: restricted });
    expect(u.permissions).not.toContain('contacts.view');
    expect(u.permissions).not.toContain('tools.use');
    expect(u.permissions).toContain('tickets.use');
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
