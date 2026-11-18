import { type GroupFlag, type Permission, effectivePermissions, hasPermission } from '@cc/shared';
import { useSessionUser } from './use-session';

/**
 * Permissions of the current user (role set minus operator-group restrictions).
 * UI convenience only — the server checks the same permissions.
 */
export function usePermissions(): Set<Permission> {
  return effectivePermissions(useSessionUser());
}

/** `usePermission('users.manage')`; a group flag name ('canSeeContacts') works too. */
export function usePermission(permission: Permission | GroupFlag): boolean {
  return hasPermission(useSessionUser(), permission);
}
