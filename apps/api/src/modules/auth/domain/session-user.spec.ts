import { ALL_PERMISSIONS, effectivePermissions, hasPermission } from '@cc/shared';
import { buildSessionUser, parseGroupPermissions } from './session-user.js';

const base = { id: 1, username: 'u', extension: '205', email: null };
const restricted = {
  canSeeContacts: false,
  canEditContacts: false,
  canUseRemoteDesktop: false,
  canRequestHelp: false,
  canUseTools: false,
};

describe('session user permissions', () => {
  it('admins always get every permission, even in a restricted group', () => {
    const u = buildSessionUser({ ...base, role: 'admin', groupId: 2, groupPermissions: restricted });
    expect(u.permissions).toEqual(ALL_PERMISSIONS);
  });

  it('operators get their group flags', () => {
    const u = buildSessionUser({ ...base, role: 'operator', groupId: 2, groupPermissions: restricted });
    expect(u.permissions).toEqual(restricted);
    expect(hasPermission(u, 'canSeeContacts')).toBe(false);
  });

  it('operators without a group are not restricted (legacy main group)', () => {
    const u = buildSessionUser({ ...base, role: 'operator', groupId: null, groupPermissions: null });
    expect(u.permissions).toEqual(ALL_PERMISSIONS);
  });

  it('missing flags in stored groups default to allowed', () => {
    expect(parseGroupPermissions({ canSeeContacts: false })).toEqual({ ...ALL_PERMISSIONS, canSeeContacts: false });
    expect(parseGroupPermissions('garbage')).toEqual(ALL_PERMISSIONS);
  });

  it('effectivePermissions works for session users without the optional field', () => {
    expect(effectivePermissions({ role: 'operator' })).toEqual(ALL_PERMISSIONS);
    expect(effectivePermissions({ role: 'superuser', permissions: restricted })).toEqual(ALL_PERMISSIONS);
  });
});
