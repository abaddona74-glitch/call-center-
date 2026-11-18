import { type Permission, type RoleLevel, type SessionUser, hasPermission, hasRoleAtLeast } from '@cc/shared';
import { redirect } from '@tanstack/react-router';

/**
 * Route guards for `beforeLoad` (convenience only — the server checks the same thing):
 *   beforeLoad: ({ context }) => requirePermission(context.user, 'users.manage')
 */
export function requirePermission(user: SessionUser, ...anyOf: Permission[]): void {
  if (!anyOf.some((p) => hasPermission(user, p))) throw redirect({ to: '/' });
}

/** @deprecated minimum role level ('admin' = executive). Use `requirePermission`. */
export function requireRole(user: SessionUser, minimum: RoleLevel): void {
  if (!hasRoleAtLeast(user.role, minimum)) throw redirect({ to: '/' });
}
