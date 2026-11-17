import { hasRoleAtLeast, type Role, type SessionUser } from '@cc/shared';
import { redirect } from '@tanstack/react-router';

/** Use in a route's beforeLoad: `beforeLoad: ({ context }) => requireRole(context.user, 'admin')`. */
export function requireRole(user: SessionUser, minimum: Role): void {
  if (!hasRoleAtLeast(user.role, minimum)) throw redirect({ to: '/' });
}
