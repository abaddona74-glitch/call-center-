import {
  ALL_PERMISSIONS,
  DEFAULT_OPERATOR_PERMISSIONS,
  type Permissions,
  PermissionsSchema,
  type Role,
  type SessionUser,
} from '@cc/shared';

export interface SessionUserRow {
  id: number;
  username: string;
  role: Role;
  extension: string | null;
  email: string | null;
  groupId: number | null;
  /** operator_groups.permissions (jsonb) of the user's group, null when no group. */
  groupPermissions: unknown;
}

/** Stored group flags -> full permission object (unknown/missing flags fall back to defaults). */
export function parseGroupPermissions(raw: unknown): Permissions {
  const parsed = PermissionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_OPERATOR_PERMISSIONS;
}

export function permissionsFor(role: Role, groupId: number | null, groupPermissions: unknown): Permissions {
  if (role !== 'operator') return ALL_PERMISSIONS;
  if (groupId === null) return DEFAULT_OPERATOR_PERMISSIONS;
  return parseGroupPermissions(groupPermissions);
}

export function buildSessionUser(row: SessionUserRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    extension: row.extension,
    email: row.email,
    groupId: row.groupId,
    permissions: permissionsFor(row.role, row.groupId, row.groupPermissions),
  };
}
