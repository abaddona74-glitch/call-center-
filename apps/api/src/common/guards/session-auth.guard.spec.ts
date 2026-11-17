import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SessionUser } from '@cc/shared';
import { IS_PUBLIC_KEY, PERMISSION_KEY, ROLES_KEY } from '../decorators/auth.decorators.js';
import { SessionAuthGuard } from './session-auth.guard.js';

const restricted = {
  canSeeContacts: false,
  canEditContacts: false,
  canUseRemoteDesktop: false,
  canRequestHelp: false,
  canUseTools: false,
};

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

const operator = (permissions = restricted): SessionUser => ({
  id: 5,
  username: 'op',
  role: 'operator',
  extension: '205',
  email: null,
  groupId: 2,
  permissions,
});

describe('SessionAuthGuard', () => {
  it('lets public routes through without a session', async () => {
    const { guard, ctx } = setup(null, { [IS_PUBLIC_KEY]: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects missing sessions with 401 and puts the user in the request', async () => {
    await expect(setup(null, {}).guard.canActivate(setup(null, {}).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    const { guard, ctx, req, cls } = setup(operator(), {});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toMatchObject({ username: 'op' });
    expect(cls.set).toHaveBeenCalledWith('sessionId', 's1');
  });

  it('enforces the minimum role', async () => {
    const { guard, ctx } = setup(operator(), { [ROLES_KEY]: 'admin' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces @RequirePermission for restricted operator groups only', async () => {
    const denied = setup(operator(), { [PERMISSION_KEY]: 'canSeeContacts' });
    await expect(denied.guard.canActivate(denied.ctx)).rejects.toBeInstanceOf(ForbiddenException);

    const allowed = setup(operator({ ...restricted, canSeeContacts: true }), { [PERMISSION_KEY]: 'canSeeContacts' });
    await expect(allowed.guard.canActivate(allowed.ctx)).resolves.toBe(true);

    const admin = setup({ ...operator(), role: 'admin' }, { [PERMISSION_KEY]: 'canSeeContacts' });
    await expect(admin.guard.canActivate(admin.ctx)).resolves.toBe(true);

    const legacyShape = setup(
      { id: 1, username: 'x', role: 'operator', extension: '101', email: null },
      { [PERMISSION_KEY]: 'canUseTools' },
    );
    await expect(legacyShape.guard.canActivate(legacyShape.ctx)).resolves.toBe(true);
  });
});
