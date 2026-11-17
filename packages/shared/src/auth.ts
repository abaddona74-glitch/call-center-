import { z } from 'zod';

/** Roles in the system. Order matters: higher index = more privileges. */
export const ROLES = ['operator', 'admin', 'superuser'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export function hasRoleAtLeast(role: Role, minimum: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum);
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
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const MeResponseSchema = z.object({
  user: SessionUserSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
