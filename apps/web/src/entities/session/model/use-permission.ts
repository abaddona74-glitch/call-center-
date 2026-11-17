import { type PermissionFlag, type Permissions, effectivePermissions } from '@cc/shared';
import { useSessionUser } from './use-session';

/**
 * Operator-group permissions of the current user (admins: everything).
 * UI convenience only — the server checks the same flags.
 */
export function usePermissions(): Permissions {
  return effectivePermissions(useSessionUser());
}

export function usePermission(flag: PermissionFlag): boolean {
  return usePermissions()[flag];
}
