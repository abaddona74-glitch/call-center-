import {
  canGrantRole,
  canManage,
  checkCreate,
  checkCredentialsAdmin,
  checkDelete,
  checkUpdate,
} from './user-policy.js';

const su = { id: 1, role: 'superuser' as const };
const su2 = { id: 2, role: 'superuser' as const, isActive: true };
const admin = { id: 3, role: 'admin' as const };
const admin2 = { id: 4, role: 'admin' as const, isActive: true };
const op = { id: 5, role: 'operator' as const, isActive: true };
const opActor = { id: 5, role: 'operator' as const };

describe('user policy', () => {
  it('superuser manages everyone, admin only operators, operator nobody', () => {
    expect(canManage(su, su2)).toBe(true);
    expect(canManage(su, admin2)).toBe(true);
    expect(canManage(admin, op)).toBe(true);
    expect(canManage(admin, admin2)).toBe(false);
    expect(canManage(admin, su2)).toBe(false);
    expect(canManage(opActor, op)).toBe(false);
  });

  it('only superusers grant admin/superuser', () => {
    expect(canGrantRole(su, 'superuser')).toBe(true);
    expect(canGrantRole(admin, 'operator')).toBe(true);
    expect(canGrantRole(admin, 'admin')).toBe(false);
    expect(canGrantRole(admin, 'superuser')).toBe(false);
    expect(checkCreate(admin, 'superuser')).toMatchObject({ ok: false, status: 403 });
    expect(checkCreate(opActor, 'operator')).toMatchObject({ ok: false, status: 403 });
    expect(checkCreate(su, 'admin')).toEqual({ ok: true });
  });

  it('admin cannot promote an operator', () => {
    expect(checkUpdate(admin, op, { role: 'admin' }, 1)).toMatchObject({ ok: false, status: 403 });
    expect(checkUpdate(admin, op, { role: 'superuser' }, 1)).toMatchObject({ ok: false, status: 403 });
    expect(checkUpdate(admin, op, { other: true, isActive: false }, 1)).toEqual({ ok: true });
  });

  it('admin cannot touch admins or superusers, not even themselves', () => {
    expect(checkUpdate(admin, admin2, { other: true }, 1)).toMatchObject({ ok: false, status: 403 });
    expect(checkUpdate(admin, su2, { isActive: false }, 2)).toMatchObject({ ok: false, status: 403 });
    expect(checkUpdate(admin, { ...admin, isActive: true }, { other: true }, 1)).toMatchObject({ ok: false });
    expect(checkDelete(admin, su2, 2)).toMatchObject({ ok: false, status: 403 });
  });

  it('protects the last superuser', () => {
    const lone = { id: 9, role: 'superuser' as const, isActive: true };
    expect(checkUpdate(su, lone, { role: 'admin' }, 1)).toMatchObject({ ok: false, status: 409 });
    expect(checkUpdate(su, lone, { isActive: false }, 1)).toMatchObject({ ok: false, status: 409 });
    expect(checkDelete(su, lone, 1)).toMatchObject({ ok: false, status: 409 });
    expect(checkUpdate(su, lone, { role: 'admin' }, 2)).toEqual({ ok: true });
    expect(checkDelete(su, lone, 2)).toEqual({ ok: true });
    // an inactive superuser is not "the last" one
    expect(checkDelete(su, { ...lone, isActive: false }, 1)).toEqual({ ok: true });
  });

  it('nobody deletes, deactivates or re-roles themselves', () => {
    const me = { ...su, isActive: true };
    expect(checkDelete(su, me, 5)).toMatchObject({ ok: false, status: 403 });
    expect(checkUpdate(su, me, { isActive: false }, 5)).toMatchObject({ ok: false, status: 403 });
    expect(checkUpdate(su, me, { role: 'admin' }, 5)).toMatchObject({ ok: false, status: 403 });
    expect(checkUpdate(su, me, { other: true }, 5)).toEqual({ ok: true });
  });

  it('credential admin follows manage rules and excludes self', () => {
    expect(checkCredentialsAdmin(admin, op)).toEqual({ ok: true });
    expect(checkCredentialsAdmin(admin, admin2)).toMatchObject({ ok: false });
    expect(checkCredentialsAdmin(su, su2)).toEqual({ ok: true });
    expect(checkCredentialsAdmin(su, { id: 1, role: 'superuser' })).toMatchObject({ ok: false });
  });
});
