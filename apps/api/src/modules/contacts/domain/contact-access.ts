import type { ContactAccess, Role } from '@cc/shared';

/**
 * Who may see / edit the phonebook. The single place to change when operator groups land (S1):
 * once the session user carries `permissions` (canSeeContacts / canEditContacts), those win; until
 * then the legacy rule applies — operators whose extension falls in a denied range (the "200 group")
 * get neither. Admins and superusers always may.
 */
export interface ContactAccessUser {
  role: Role;
  extension: string | null;
  permissions?: { canSeeContacts?: boolean; canEditContacts?: boolean } | null;
}

export interface ExtensionRange {
  from: number;
  to: number;
}

/** "200-299" → {200, 299}; "205" → {205, 205}. Invalid items are rejected by the env schema. */
export function parseExtensionRanges(items: readonly string[]): ExtensionRange[] {
  return items.map((item) => {
    const [a, b] = item.split('-').map((x) => Number.parseInt(x, 10));
    return { from: Math.min(a, b ?? a), to: Math.max(a, b ?? a) };
  });
}

export function inRanges(extension: string | null, ranges: readonly ExtensionRange[]): boolean {
  if (!extension || !/^\d+$/.test(extension)) return false;
  const n = Number.parseInt(extension, 10);
  return ranges.some((r) => n >= r.from && n <= r.to);
}

export function contactAccessFor(user: ContactAccessUser, deniedRanges: readonly ExtensionRange[]): ContactAccess {
  if (user.role === 'admin' || user.role === 'superuser') return { canView: true, canEdit: true };
  if (user.permissions) {
    const canView = user.permissions.canSeeContacts ?? true;
    return { canView, canEdit: canView && (user.permissions.canEditContacts ?? true) };
  }
  const denied = inRanges(user.extension, deniedRanges);
  return { canView: !denied, canEdit: !denied };
}
