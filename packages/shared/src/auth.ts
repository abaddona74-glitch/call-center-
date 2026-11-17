import { z } from 'zod';
import { PermissionSchema } from './permissions.js';

/**
 * Roles (owner decision 2026-11-17; there is no `admin` any more).
 * Authorize with PERMISSIONS (permissions.ts: `hasPermission`, `@RequirePermission`), not role names.
 */
export const ROLES = ['operator', 'observer', 'executive', 'superuser'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/**
 * @deprecated Compatibility layer for code written before permissions: a minimum "level" for
 * `@Roles()`, `hasRoleAtLeast`, `minRole`. `'admin'` (old name) = executive level.
 * New code: `@RequirePermission(...)` / `hasPermission(...)`.
 */
export type RoleLevel = Role | 'admin';
const LEVEL: Record<RoleLevel, number> = { operator: 0, observer: 1, executive: 2, admin: 2, superuser: 3 };

/** @deprecated see RoleLevel. */
export function hasRoleAtLeast(role: Role, minimum: RoleLevel): boolean {
  return (LEVEL[role] ?? -1) >= LEVEL[minimum];
}

export const UsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Only latin letters, digits and _ . -');

export const PasswordSchema = z.string().min(10).max(200);

/** Asterisk extension, e.g. "101" or "205". */
export const ExtensionSchema = z.string().trim().regex(/^[0-9]{2,6}$/, 'Extension must be 2-6 digits');

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** The authenticated user as returned by /api/auth/me and stored in request context. */
export const SessionUserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  role: RoleSchema,
  extension: z.string().nullable(),
  email: z.string().nullable(),
  /** Operator group (null = no group). Always filled by the API; optional for older literals. */
  groupId: z.number().int().nullable().optional(),
  /** Effective permissions (role set minus group restrictions). Always filled by the API; read with `hasPermission`. */
  permissions: z.array(PermissionSchema).optional(),
  /** The user must change the password before anything else (only /auth/me, /auth/password, logout work). */
  mustChangePassword: z.boolean().optional(),
  /** Set when a superuser is acting as this user ("log in as"): who, and until when. */
  impersonation: z
    .object({
      by: z.object({ id: z.number().int(), username: z.string() }),
      expiresAt: z.iso.datetime(),
    })
    .nullable()
    .optional(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const MeResponseSchema = z.object({
  user: SessionUserSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
