import { type Permission, effectivePermissions, hasPermission } from '@cc/shared';
import { useSessionUser } from './use-session';

/**
 * Permissions of the current user (the role's set).
 * UI convenience only — the server checks the same permissions.
 */
export function usePermissions(): Set<Permission> {
  return effectivePermissions(useSessionUser());
}

/** `usePermission('users.manage')`. */
export function usePermission(permission: Permission): boolean {
  return hasPermission(useSessionUser(), permission);
}
