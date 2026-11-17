import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { PermissionFlag, Role, SessionUser } from '@cc/shared';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const PERMISSION_KEY = 'auth:permission';

/** Endpoint is reachable without a session (login, health, desktop-agent ingest with its own key...). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Minimum role required. `@Roles('admin')` allows admin and superuser.
 * Without @Roles any authenticated user (including operators) is allowed.
 */
export const Roles = (minimum: Role) => SetMetadata(ROLES_KEY, minimum);

/**
 * Operator-group permission required (admins and superusers always pass).
 * `@RequirePermission('canSeeContacts')` replaces the legacy "extension >= 200" checks.
 */
export const RequirePermission = (flag: PermissionFlag) => SetMetadata(PERMISSION_KEY, flag);

/** The authenticated user (from request context). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser | undefined => {
  const req = ctx.switchToHttp().getRequest<{ user?: SessionUser }>();
  return req.user;
});
