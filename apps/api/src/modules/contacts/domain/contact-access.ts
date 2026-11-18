import { type ContactAccess, type Permission, type Role, hasPermission } from '@cc/shared';

/**
 * Who may see / edit the phonebook: the `contacts.view` / `contacts.manage` permissions (role map + the
 * operator group's canSeeContacts / canEditContacts flags, see @cc/shared permissions). Sessions always
 * carry `permissions`; only a user object without them falls back to the role map plus the legacy rule —
 * operators whose extension falls in a denied range (the "200 group") get neither.
 */
export interface ContactAccessUser {
  role: Role;
  extension: string | null;
  permissions?: readonly Permission[] | null;
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
  if (!user.permissions && user.role === 'operator' && inRanges(user.extension, deniedRanges)) {
    return { canView: false, canEdit: false };
  }
  const canView = hasPermission(user, 'contacts.view');
  return { canView, canEdit: canView && hasPermission(user, 'contacts.manage') };
}
