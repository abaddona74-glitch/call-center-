import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_PERMISSIONS, type SessionUser } from '@cc/shared';
import {
  ALLOW_PASSWORD_CHANGE_PENDING_KEY,
  DENY_IMPERSONATION_KEY,
  IS_PUBLIC_KEY,
  PERMISSION_KEY,
  ROLES_KEY,
} from '../decorators/auth.decorators.js';
import { PASSWORD_CHANGE_REQUIRED, SessionAuthGuard } from './session-auth.guard.js';

function setup(user: SessionUser | null, meta: Record<string, unknown>) {
  const reflector = { getAllAndOverride: vi.fn((key: string) => meta[key]) } as unknown as Reflector;
  const sessions = { validate: vi.fn(async () => (user ? { sessionId: 's1', user } : null)) };
  const cls = { set: vi.fn() };
  const guard = new SessionAuthGuard(reflector, sessions as never, cls as never);
  const req: Record<string, unknown> = { headers: {}, cookies: { cc_session: 'token' } };
  const ctx = {
    getType: () => 'http',
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { guard, ctx, req, cls };
}

const operator = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: 5,
  username: 'op',
  role: 'operator',
  extension: '205',
  email: null,
  groupId: 2,
  permissions: ROLE_PERMISSIONS.operator.filter((p) => p !== 'contacts.view'),
  ...over,
});
const run = (user: SessionUser | null, meta: Record<string, unknown>) => {
  const { guard, ctx } = setup(user, meta);
  return guard.canActivate(ctx);
};

describe('SessionAuthGuard', () => {
  it('lets public routes through without a session', async () => {
    await expect(run(null, { [IS_PUBLIC_KEY]: true })).resolves.toBe(true);
  });

  it('rejects missing sessions with 401 and puts the user in the request', async () => {
    await expect(run(null, {})).rejects.toBeInstanceOf(UnauthorizedException);
    const { guard, ctx, req, cls } = setup(operator(), {});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toMatchObject({ username: 'op' });
    expect(cls.set).toHaveBeenCalledWith('sessionId', 's1');
  });

  it('checks @RequirePermission against the effective permissions', async () => {
    await expect(run(operator(), { [PERMISSION_KEY]: 'contacts.view' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(operator(), { [PERMISSION_KEY]: 'canSeeContacts' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(operator(), { [PERMISSION_KEY]: 'tickets.use' })).resolves.toBe(true);
    await expect(run(operator(), { [PERMISSION_KEY]: 'users.manage' })).rejects.toBeInstanceOf(ForbiddenException);
    const exec = operator({ role: 'executive', permissions: [...ROLE_PERMISSIONS.executive] });
    await expect(run(exec, { [PERMISSION_KEY]: 'settings.manage' })).resolves.toBe(true);
    await expect(run(exec, { [PERMISSION_KEY]: 'users.manage' })).rejects.toBeInstanceOf(ForbiddenException);
    // objects without `permissions` fall back to the role's set
    const bare: SessionUser = { id: 1, username: 'x', role: 'operator', extension: '101', email: null };
    await expect(run(bare, { [PERMISSION_KEY]: 'contacts.view' })).resolves.toBe(true);
  });

  it('keeps @Roles working as a compatibility layer (admin = executive level)', async () => {
    await expect(run(operator(), { [ROLES_KEY]: 'admin' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(operator({ role: 'executive' }), { [ROLES_KEY]: 'admin' })).resolves.toBe(true);
    await expect(run(operator({ role: 'observer' }), { [ROLES_KEY]: 'admin' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks everything but the allowed endpoints until a forced password change is done', async () => {
    const pending = operator({ mustChangePassword: true });
    await expect(run(pending, {})).rejects.toThrow(PASSWORD_CHANGE_REQUIRED);
    await expect(run(pending, { [ALLOW_PASSWORD_CHANGE_PENDING_KEY]: true })).resolves.toBe(true);
    // a superuser acting as the user is not forced to change the user's password
    const impersonated = { ...pending, impersonation: { by: { id: 1, username: 'boss' }, expiresAt: new Date().toISOString() } };
    await expect(run(impersonated, {})).resolves.toBe(true);
  });

  it('refuses account self-service while acting as another user', async () => {
    const impersonated = operator({ impersonation: { by: { id: 1, username: 'boss' }, expiresAt: new Date().toISOString() } });
    await expect(run(impersonated, { [DENY_IMPERSONATION_KEY]: true })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(operator(), { [DENY_IMPERSONATION_KEY]: true })).resolves.toBe(true);
  });
});
