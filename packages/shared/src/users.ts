import { z } from 'zod';
import { ExtensionSchema, PasswordSchema, RoleSchema, UsernameSchema } from './auth.js';

/**
 * User administration (permission `users.manage`). Base path /api/users.
 * Only a superuser manages superusers or grants the superuser role; the last active superuser cannot be
 * removed, demoted or deactivated.
 */

export const UserIdParamSchema = z.coerce.number().int().positive();

const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().toLowerCase().pipe(z.email().max(254)).nullable(),
);
const optionalExtension = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  ExtensionSchema.nullable(),
);

export const UserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  role: RoleSchema,
  extension: z.string().nullable(),
  email: z.string().nullable(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
  passkeyCount: z.number().int(),
  activeSessions: z.number().int(),
  /** The current user may edit/reset/delete this user. */
  canManage: z.boolean(),
  /** The current user may "log in as" this user. */
  canImpersonate: z.boolean(),
});
export type User = z.infer<typeof UserSchema>;

export const UserListSchema = z.object({ items: z.array(UserSchema) });
export type UserList = z.infer<typeof UserListSchema>;

export const UserListQuerySchema = z.object({
  search: z.string().trim().max(64).optional(),
  role: RoleSchema.optional(),
  active: z.stringbool().optional(),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

export const CreateUserSchema = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema,
    role: RoleSchema.default('operator'),
    extension: optionalExtension.default(null),
    email: optionalEmail.default(null),
    /** Ask for a new password at first login. */
    mustChangePassword: z.boolean().default(false),
  })
  .refine((u) => u.role !== 'operator' || u.extension !== null, {
    path: ['extension'],
    message: 'Operators need an extension',
  });
export type CreateUser = z.input<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    username: UsernameSchema,
    role: RoleSchema,
    extension: optionalExtension,
    email: optionalEmail,
    isActive: z.boolean(),
    mustChangePassword: z.boolean(),
  })
  .partial()
  .refine((u) => Object.keys(u).length > 0, { message: 'Nothing to update' });
export type UpdateUser = z.input<typeof UpdateUserSchema>;

/** POST /api/users/:id/password — admin sets a new password; the user's sessions end. */
export const ResetUserPasswordSchema = z.object({
  password: PasswordSchema,
  /** Also delete the user's passkeys (default: yes — the account may be compromised). */
  revokePasskeys: z.boolean().default(true),
  /** The user has to replace this password at the next login (default: yes). */
  mustChangePassword: z.boolean().default(true),
});
export type ResetUserPassword = z.input<typeof ResetUserPasswordSchema>;

export const ResetUserPasswordResultSchema = z.object({
  revokedSessions: z.number().int(),
  revokedPasskeys: z.number().int(),
});
export type ResetUserPasswordResult = z.infer<typeof ResetUserPasswordResultSchema>;
