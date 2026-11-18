import { type ContactAccess, type Permission, type Role, hasPermission } from '@cc/shared';

/**
 * Who may see / edit the phonebook: the `contacts.view` / `contacts.manage` permissions (role map + the
 * operator group's canSeeContacts / canEditContacts flags, see @cc/shared permissions). The legacy
 * "extension >= 200" rule now lives in the seeded `Zangiota` operator group.
 */
export interface ContactAccessUser {
  role: Role;
  permissions?: readonly Permission[] | null;
}

export function contactAccessFor(user: ContactAccessUser): ContactAccess {
  const canView = hasPermission(user, 'contacts.view');
  return { canView, canEdit: canView && hasPermission(user, 'contacts.manage') };
}
