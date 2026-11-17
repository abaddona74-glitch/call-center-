import { z } from 'zod';
// type-only: auth.ts imports this file at runtime (SessionUserSchema), so no value import back.
import type { Role } from './auth.js';

/**
 * Permission-based access (owner decision 2026-11-17: roles superuser / executive / observer / operator,
 * executive and observer logic to be described later). Code checks PERMISSIONS, never role names:
 *   server: `@RequirePermission('users.manage')` (apps/api common/decorators)
 *   web:    `usePermission('users.manage')`, `requirePermission(context.user, 'users.manage')`
 * Which role has which permission lives ONLY in ROLE_PERMISSIONS below.
 */
export const PERMISSIONS = [
  /** Live dashboard, operators board, queues, who is online. */
  'monitor.view',
  /** Call history, statistics, reports and exports. */
  'reports.view',
  /** Listen to / download recordings and transcripts. */
  'recordings.listen',
  'callbacks.view',
  /** Close / dismiss callbacks manually. */
  'callbacks.manage',
  /** Client names and organizations next to numbers, the client book. */
  'contacts.view',
  'contacts.manage',
  'blacklist.manage',
  /** PBX actions: pause/unpause operators, transfer, hang up, originate, queue adjustments. */
  'actions.call',
  'tickets.use',
  /** Tools section (converter, links, installers). */
  'tools.use',
  'remoteDesktop.use',
  /** "Help" ring to other operators. */
  'help.request',
  /** System settings: excluded operators, working hours, holidays, interface options. */
  'settings.manage',
  'audit.view',
  /** Users, roles, operator groups, other people's passwords and passkeys. */
  'users.manage',
  /** See and end other people's sessions. */
  'sessions.manage',
  /** Login protection settings and unlocking. */
  'security.manage',
  /** "Log in as another user" (time-limited, audited). */
  'impersonate',
] as const;
export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

const ALL: readonly Permission[] = PERMISSIONS;
const without = (...excluded: Permission[]) => ALL.filter((p) => !excluded.includes(p));

/**
 * THE role → permissions map. Interim sets until the owner describes executive/observer:
 *  - superuser: everything;
 *  - executive: everything except user/role/session/security management and impersonation;
 *  - observer: read-only;
 *  - operator: the operator portal (legacy 3005).
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  superuser: ALL,
  executive: without('users.manage', 'sessions.manage', 'security.manage', 'impersonate'),
  observer: ['monitor.view', 'reports.view', 'recordings.listen', 'callbacks.view', 'contacts.view'],
  operator: [
    'monitor.view',
    'callbacks.view',
    'contacts.view',
    'contacts.manage',
    'tickets.use',
    'tools.use',
    'remoteDesktop.use',
    'help.request',
  ],
};

// --- operator groups ----------------------------------------------------------------------
/**
 * Per-group restriction flags for operators (replaces the legacy "extension >= 200" rule).
 * `false` removes the matching permission from the group's operators; other roles are not affected.
 * New flags must get `.default(true)` so stored groups without the flag stay valid.
 */
export const GroupFlagsSchema = z.object({
  canSeeContacts: z.boolean().default(true),
  canEditContacts: z.boolean().default(true),
  canUseRemoteDesktop: z.boolean().default(true),
  canRequestHelp: z.boolean().default(true),
  canUseTools: z.boolean().default(true),
});
export type GroupFlags = z.infer<typeof GroupFlagsSchema>;
export type GroupFlag = keyof GroupFlags;
export const GROUP_FLAGS = Object.keys(GroupFlagsSchema.shape) as GroupFlag[];

/** Which permission each group flag controls. */
export const GROUP_FLAG_PERMISSION: Readonly<Record<GroupFlag, Permission>> = {
  canSeeContacts: 'contacts.view',
  canEditContacts: 'contacts.manage',
  canUseRemoteDesktop: 'remoteDesktop.use',
  canRequestHelp: 'help.request',
  canUseTools: 'tools.use',
};

export const ALL_GROUP_FLAGS: GroupFlags = {
  canSeeContacts: true,
  canEditContacts: true,
  canUseRemoteDesktop: true,
  canRequestHelp: true,
  canUseTools: true,
};

/** Effective permissions: the role's set, minus what the operator's group switches off. */
export function permissionsFor(role: Role, groupFlags: GroupFlags | null | undefined): Permission[] {
  const base = ROLE_PERMISSIONS[role] ?? [];
  if (role !== 'operator' || !groupFlags) return [...base];
  const denied = new Set(GROUP_FLAGS.filter((f) => !groupFlags[f]).map((f) => GROUP_FLAG_PERMISSION[f]));
  return base.filter((p) => !denied.has(p));
}

/**
 * Permissions of a session user. The API always sends `permissions`; objects without it
 * (older literals, tests) fall back to the role's set.
 */
export function effectivePermissions(user: {
  role: Role;
  permissions?: readonly Permission[] | null;
}): Set<Permission> {
  return new Set(user.permissions ?? ROLE_PERMISSIONS[user.role] ?? []);
}

/**
 * `hasPermission(user, 'users.manage')`. A group flag name (`'canSeeContacts'`) is accepted too and
 * means its permission (compatibility with the first version of this contract).
 */
export function hasPermission(
  user: { role: Role; permissions?: readonly Permission[] | null },
  permission: Permission | GroupFlag,
): boolean {
  const p = (GROUP_FLAG_PERMISSION as Record<string, Permission>)[permission] ?? (permission as Permission);
  return effectivePermissions(user).has(p);
}
