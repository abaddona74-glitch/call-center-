import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Role, SessionUser } from '@cc/shared';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/** Endpoint is reachable without a session (login, health, desktop-agent ingest with its own key...). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Minimum role required. `@Roles('admin')` allows admin and superuser.
 * Without @Roles any authenticated user (including operators) is allowed.
 */
export const Roles = (minimum: Role) => SetMetadata(ROLES_KEY, minimum);

/** The authenticated user (from request context). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser | undefined => {
  const req = ctx.switchToHttp().getRequest<{ user?: SessionUser }>();
  return req.user;
});
