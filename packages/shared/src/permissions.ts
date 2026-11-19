import { z } from 'zod';
// type-only: auth.ts imports this file at runtime (SessionUserSchema), so no value import back.
import type { Role } from './auth.js';

/**
 * Permission-based access (owner decision 2026-11-17: roles superuser / executive / observer / operator).
 * Code checks PERMISSIONS, never role names:
 *   server: `@RequirePermission('users.manage')` (apps/api common/decorators)
 *   web:    `usePermission('users.manage')`, `requirePermission(context.user, 'users.manage')`
 * Which role has which permission lives ONLY in ROLE_PERMISSIONS below.
 */
export const PERMISSIONS = [
  /** Live dashboard, operators board, queues, own calls (operators see citizen numbers masked). */
  'monitor.view',
  /** Everything live unmasked: all citizen numbers, today's KPI counters, who is online. */
  'monitor.viewAll',
  /** Call history, statistics, reports and exports. */
  'reports.view',
  /** Listen to / download recordings and transcripts. */
  'recordings.listen',
  /** AI call analysis: the queue, backfill and retries (docs/rewrite/CALL-ANALYSIS.md). */
  'analysis.manage',
  'callbacks.view',
  /** Close / dismiss callbacks manually. */
  'callbacks.manage',
  /** Client names and organizations next to numbers, the client book. */
  'contacts.view',
  'contacts.manage',
  'blacklist.manage',
  /** PBX actions: pause/unpause operators, transfer, hang up, originate, queue adjustments. */
  'actions.call',
  /** Tickets (docs/rewrite/TICKETS.md): create a ticket from/after a call. */
  'tickets.create',
  /** Call the citizen back on a done/rejected ticket and close it (operators' common queue). */
  'tickets.callback',
  /** Take, process, finish, forward tickets — scoped to the executive's regions by the tickets module. */
  'tickets.process',
  /** See every ticket of every region (read). */
  'tickets.viewAll',
  /** Regions, cities/districts, categories, executive ↔ region assignments. */
  'tickets.directories.manage',
  /** Close a ticket without a confirmed call (with a reason), delete, triage tickets without a region. */
  'tickets.administer',
  /** Tools page: links, installers, the managers directory, Uzcrypto (docs: tools.ts). */
  'tools.view',
  /** Extra tools legacy hid from the "200" group: the file converter and the Ijro letter generator. */
  'tools.use',
  /** "Help" ring to other operators. */
  'help.request',
  /** System settings: excluded operators, working hours, holidays, interface options. */
  'settings.manage',
  'audit.view',
  /** Users, roles, other people's passwords and passkeys. */
  'users.manage',
  /** See and end other people's sessions. */
  'sessions.manage',
  /** Login protection settings and unlocking. */
  'security.manage',
  /** "Log in as another user" (time-limited, audited). */
  'impersonate',
  /** The static guide pages ("Yo'riqnoma": the systems/roles tree, the manual, the softphone guide). */
  'guide.view',
] as const;
export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

const ALL: readonly Permission[] = PERMISSIONS;

/**
 * THE role → permissions map:
 *  - superuser: everything;
 *  - executive ("Mas'ul" in the UI, owner decision 2026-11-19): ONLY processes the tickets of its regions —
 *    the tickets board, the ticket reports and its own profile; no monitoring, calls, contacts, tools or
 *    settings (the owner adds more later if needed);
 *  - observer: read-only (sees all tickets, cannot change them);
 *  - operator: the operator portal (legacy 3005) + creating tickets and calling citizens back.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  superuser: ALL,
  executive: ['tickets.process'],
  observer: [
    'monitor.view',
    'monitor.viewAll',
    'reports.view',
    'recordings.listen',
    'callbacks.view',
    'contacts.view',
    'tickets.viewAll',
    'tools.view',
    'guide.view',
  ],
  operator: [
    'monitor.view',
    'callbacks.view',
    'contacts.view',
    'contacts.manage',
    'tickets.create',
    'tickets.callback',
    'tools.view',
    'tools.use',
    'help.request',
    'guide.view',
  ],
};

/** The permissions of a role (the one place that decides who may do what). */
export function permissionsFor(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
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

/** `hasPermission(user, 'users.manage')`. */
export function hasPermission(
  user: { role: Role; permissions?: readonly Permission[] | null },
  permission: Permission,
): boolean {
  return effectivePermissions(user).has(permission);
}

/** Short alias for api and web: `can(user, 'tickets.process')`. */
export const can = hasPermission;
