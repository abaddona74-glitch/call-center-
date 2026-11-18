import { type Permission, type SessionUser, hasPermission } from '@cc/shared';
import { redirect } from '@tanstack/react-router';

/**
 * Route guards for `beforeLoad` (convenience only — the server checks the same thing):
 *   beforeLoad: ({ context }) => requirePermission(context.user, 'users.manage')
 */
export function requirePermission(user: SessionUser, ...anyOf: Permission[]): void {
  if (!anyOf.some((p) => hasPermission(user, p))) throw redirect({ to: '/' });
}
