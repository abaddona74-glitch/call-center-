import { type Permission, type SessionUser, hasPermission } from '@cc/shared';

export type SettingsPath =
  | '/settings/security'
  | '/settings/exclude'
  | '/settings/users'
  | '/settings/groups'
  | '/settings/sessions'
  | '/settings/calendar'
  | '/settings/audit';

/** Settings tabs and the permission each needs (legacy order: security first). */
export const SETTINGS_TABS: { to: SettingsPath; key: string; permission: Permission }[] = [
  { to: '/settings/security', key: 'security', permission: 'security.manage' },
  { to: '/settings/exclude', key: 'exclude', permission: 'settings.manage' },
  { to: '/settings/users', key: 'users', permission: 'users.manage' },
  { to: '/settings/groups', key: 'groups', permission: 'users.manage' },
  { to: '/settings/sessions', key: 'sessions', permission: 'sessions.manage' },
  { to: '/settings/calendar', key: 'calendar', permission: 'settings.manage' },
  { to: '/settings/audit', key: 'audit', permission: 'audit.view' },
];

/** The first tab the user may open (the /settings index redirects there). */
export function firstSettingsTab(user: SessionUser): SettingsPath {
  return SETTINGS_TABS.find((t) => hasPermission(user, t.permission))?.to ?? '/settings/audit';
}
