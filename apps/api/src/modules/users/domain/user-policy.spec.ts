import { ROLE_PERMISSIONS } from '@cc/shared';
import {
  canGrantRole,
  canImpersonate,
  canManage,
  checkCreate,
  checkCredentialsAdmin,
  checkDelete,
  checkImpersonate,
  checkUpdate,
} from './user-policy.js';

const su = { id: 1, role: 'superuser' as const };
const su2 = { id: 2, role: 'superuser' as const, isActive: true };
const exec = { id: 3, role: 'executive' as const };
const exec2 = { id: 4, role: 'executive' as const, isActive: true };
const op = { id: 5, role: 'operator' as const, isActive: true };
const observer = { id: 6, role: 'observer' as const };
/** A future role that may manage users but is not a superuser. */
const manager = {
  id: 7,
  role: 'executive' as const,
  permissions: [...ROLE_PERMISSIONS.executive, 'users.manage' as const],
};

describe('user policy', () => {
  it('managing accounts needs users.manage: superuser yes, executive/observer/operator no', () => {
    expect(canManage(su, su2)).toBe(true);
    expect(canManage(su, exec2)).toBe(true);
    expect(canManage(exec, op)).toBe(false);
    expect(canManage(observer, op)).toBe(false);
    expect(canManage({ id: 5, role: 'operator' }, op)).toBe(false);
    expect(checkCreate(exec, 'operator')).toMatchObject({ ok: false, status: 403 });
  });

  it('only a superuser manages superusers or grants the superuser role', () => {
    expect(canManage(manager, op)).toBe(true);
    expect(canManage(manager, su2)).toBe(false);
    expect(canGrantRole(manager, 'executive')).toBe(true);
    expect(canGrantRole(manager, 'superuser')).toBe(false);
    expect(canGrantRole(su, 'superuser')).toBe(true);
    expect(checkUpdate(manager, op, { role: 'superuser' }, 1)).toMatchObject({ ok: false, status: 403 });
    expect(checkUpdate(su, op, { role: 'observer' }, 1)).toEqual({ ok: true });
  });

  it('protects the last superuser', () => {
    const lone = { id: 9, role: 'superuser' as const, isActive: true };
    expect(checkUpdate(su, lone, { role: 'executive' }, 1)).toMatchObject({ ok: false, status: 409 });
    expect(checkUpdate(su, lone, { isActive: false }, 1)).toMatchObject({ ok: false, status: 409 });
    expect(checkDelete(su, lone, 1)).toMatchObject({ ok: false, status: 409 });
    expect(checkUpdate(su, lone, { role: 'executive' }, 2)).toEqual({ ok: true });
    expect(checkDelete(su, lone, 2)).toEqual({ ok: true });
    expect(checkDelete(su, { ...lone, isActive: false }, 1)).toEqual({ ok: true });
  });

  it('nobody deletes, deactivates or re-roles themselves', () => {
    const me = { ...su, isActive: true };
    expect(checkDelete(su, me, 5)).toMatchObject({ ok: false, status: 403 });
    expect(checkUpdate(su, me, { isActive: false }, 5)).toMatchObject({ ok: false, status: 403 });
    expect(checkUpdate(su, me, { role: 'executive' }, 5)).toMatchObject({ ok: false, status: 403 });
    expect(checkUpdate(su, me, {}, 5)).toEqual({ ok: true });
  });

  it('credential admin follows manage rules and excludes self', () => {
    expect(checkCredentialsAdmin(su, op)).toEqual({ ok: true });
    expect(checkCredentialsAdmin(exec, op)).toMatchObject({ ok: false });
    expect(checkCredentialsAdmin(su, su2)).toEqual({ ok: true });
    expect(checkCredentialsAdmin(su, { id: 1, role: 'superuser' })).toMatchObject({ ok: false });
  });

  it('log in as: superuser only, never a superuser, never self, only active accounts', () => {
    expect(canImpersonate(su, op)).toBe(true);
    expect(canImpersonate(su, exec2)).toBe(true);
    expect(canImpersonate(su, su2)).toBe(false);
    expect(canImpersonate(exec, op)).toBe(false);
    expect(checkImpersonate(su, { ...op, isActive: false })).toMatchObject({
      ok: false,
      reason: 'The account is disabled',
    });
    expect(checkImpersonate(su, { id: 1, role: 'operator', isActive: true })).toMatchObject({ ok: false });
    expect(checkImpersonate(exec, op)).toMatchObject({ ok: false, status: 403 });
  });
});
