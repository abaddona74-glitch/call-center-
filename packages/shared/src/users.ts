import { z } from 'zod';
import { ExtensionSchema, PasswordSchema, RoleSchema, UsernameSchema } from './auth.js';
import { PermissionsSchema } from './permissions.js';

/**
 * User administration (admin+) and operator groups. Base paths /api/users, /api/operator-groups.
 * RBAC: superuser manages everyone; admin manages only operators (cannot create/promote/modify
 * admins or superusers); the last active superuser cannot be removed, demoted or deactivated.
 */

export const UserIdParamSchema = z.coerce.number().int().positive();
export const GroupIdParamSchema = UserIdParamSchema;

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
  groupId: z.number().int().nullable(),
  groupName: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
  passkeyCount: z.number().int(),
  activeSessions: z.number().int(),
  /** The current admin may edit/reset/delete this user. */
  canManage: z.boolean(),
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
    groupId: z.number().int().positive().nullable().default(null),
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
    groupId: z.number().int().positive().nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((u) => Object.keys(u).length > 0, { message: 'Nothing to update' });
export type UpdateUser = z.input<typeof UpdateUserSchema>;

/** POST /api/users/:id/password — admin sets a new password; the user's sessions end. */
export const ResetUserPasswordSchema = z.object({
  password: PasswordSchema,
  /** Also delete the user's passkeys (default: yes — the account may be compromised). */
  revokePasskeys: z.boolean().default(true),
});
export type ResetUserPassword = z.input<typeof ResetUserPasswordSchema>;

export const ResetUserPasswordResultSchema = z.object({
  revokedSessions: z.number().int(),
  revokedPasskeys: z.number().int(),
});
export type ResetUserPasswordResult = z.infer<typeof ResetUserPasswordResultSchema>;

// --- Operator groups ---------------------------------------------------------------------

export const OperatorGroupSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  permissions: PermissionsSchema,
  memberCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type OperatorGroup = z.infer<typeof OperatorGroupSchema>;

export const OperatorGroupListSchema = z.object({ items: z.array(OperatorGroupSchema) });
export type OperatorGroupList = z.infer<typeof OperatorGroupListSchema>;

const groupName = z.string().trim().min(2).max(60);
const groupDescription = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(300).nullable(),
);

export const CreateOperatorGroupSchema = z.object({
  name: groupName,
  description: groupDescription.default(null),
  permissions: PermissionsSchema,
});
export type CreateOperatorGroup = z.input<typeof CreateOperatorGroupSchema>;

export const UpdateOperatorGroupSchema = z
  .object({
    name: groupName,
    description: groupDescription,
    permissions: PermissionsSchema,
  })
  .partial()
  .refine((g) => Object.keys(g).length > 0, { message: 'Nothing to update' });
export type UpdateOperatorGroup = z.input<typeof UpdateOperatorGroupSchema>;
