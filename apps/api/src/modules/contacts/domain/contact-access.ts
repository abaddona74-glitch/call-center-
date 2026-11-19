import { type ContactAccess, type Permission, type Role, hasPermission } from '@cc/shared';

/**
 * Who may see / edit the phonebook: the `contacts.view` / `contacts.manage` permissions of the session
 * (the role map in @cc/shared permissions). The legacy "extension >= 200" restriction is gone (owner, 19.11.2026).
 */
export interface ContactAccessUser {
  role: Role;
  permissions?: readonly Permission[] | null;
}

export function contactAccessFor(user: ContactAccessUser): ContactAccess {
  const canView = hasPermission(user, 'contacts.view');
  return { canView, canEdit: canView && hasPermission(user, 'contacts.manage') };
}
