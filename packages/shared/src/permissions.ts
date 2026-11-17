import { z } from 'zod';
// type-only: auth.ts imports this file at runtime (SessionUserSchema), so no value import back.
import type { Role } from './auth.js';

/**
 * Per-group restriction flags for operators (replaces the legacy "extension >= 200" rule).
 * Admins and superusers always have every permission.
 * New flags must get a `.default(true)` so stored groups without the flag stay valid.
 */
export const PermissionsSchema = z.object({
  /** See saved client names/organizations and the client book. */
  canSeeContacts: z.boolean().default(true),
  /** Add / edit / delete client contacts. */
  canEditContacts: z.boolean().default(true),
  /** Remote desktop (RustDesk) buttons. */
  canUseRemoteDesktop: z.boolean().default(true),
  /** Send "help" requests to other operators. */
  canRequestHelp: z.boolean().default(true),
  /** Extra tools (converter, letters, installers). */
  canUseTools: z.boolean().default(true),
});
export type Permissions = z.infer<typeof PermissionsSchema>;
export type PermissionFlag = keyof Permissions;

export const PERMISSION_FLAGS = Object.keys(PermissionsSchema.shape) as PermissionFlag[];

export const ALL_PERMISSIONS: Permissions = {
  canSeeContacts: true,
  canEditContacts: true,
  canUseRemoteDesktop: true,
  canRequestHelp: true,
  canUseTools: true,
};

/** Operators without a group behave like the legacy main ("100") group: nothing restricted. */
export const DEFAULT_OPERATOR_PERMISSIONS: Permissions = ALL_PERMISSIONS;

/** Effective permissions of a session user (works for SessionUser objects without the optional field). */
export function effectivePermissions(user: { role: Role; permissions?: Permissions | null }): Permissions {
  if (user.role === 'admin' || user.role === 'superuser') return ALL_PERMISSIONS;
  return user.permissions ?? DEFAULT_OPERATOR_PERMISSIONS;
}

export function hasPermission(user: { role: Role; permissions?: Permissions | null }, flag: PermissionFlag): boolean {
  return effectivePermissions(user)[flag];
}
