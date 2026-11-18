import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { GroupFlag, Permission, RoleLevel, SessionUser } from '@cc/shared';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const PERMISSION_KEY = 'auth:permission';
export const ALLOW_PASSWORD_CHANGE_PENDING_KEY = 'auth:allowPasswordChangePending';
export const DENY_IMPERSONATION_KEY = 'auth:denyImpersonation';

/** Endpoint is reachable without a session (login, health, desktop-agent ingest with its own key...). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * The way to authorize: a permission from `PERMISSIONS` (@cc/shared permissions.ts), e.g.
 * `@RequirePermission('users.manage')`. Which roles have it is decided in ONE place, `ROLE_PERMISSIONS`;
 * operator groups can switch some off. A group flag name (`'canSeeContacts'`) is accepted as an alias.
 */
export const RequirePermission = (permission: Permission | GroupFlag) => SetMetadata(PERMISSION_KEY, permission);

/**
 * @deprecated Compatibility for code written before permissions: minimum role level.
 * `@Roles('admin')` = executive or superuser. New code: `@RequirePermission(...)`.
 */
export const Roles = (minimum: RoleLevel) => SetMetadata(ROLES_KEY, minimum);

/**
 * Reachable while the user still has to change the password (forced change): /auth/me,
 * /auth/password, logout. Everything else answers 403 until the password is changed.
 */
export const AllowWhilePasswordChangeRequired = () => SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING_KEY, true);

/**
 * Refused while a superuser is acting as this user ("log in as"): own password, email, passkeys,
 * revoking own sessions — a superuser must not be able to take over the account this way.
 */
export const DenyWhileImpersonating = () => SetMetadata(DENY_IMPERSONATION_KEY, true);

/** The authenticated user (from request context). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser | undefined => {
  const req = ctx.switchToHttp().getRequest<{ user?: SessionUser }>();
  return req.user;
});
