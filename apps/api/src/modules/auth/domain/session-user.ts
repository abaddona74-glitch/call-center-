import {
  ALL_GROUP_FLAGS,
  type GroupFlags,
  GroupFlagsSchema,
  type Permission,
  type Role,
  type SessionUser,
  permissionsFor,
} from '@cc/shared';

export interface SessionUserRow {
  id: number;
  username: string;
  role: Role;
  extension: string | null;
  email: string | null;
  groupId: number | null;
  /** operator_groups.permissions (jsonb flags) of the user's group, null when no group. */
  groupPermissions: unknown;
  mustChangePassword?: boolean;
}

export interface ImpersonationInfo {
  by: { id: number; username: string };
  expiresAt: Date;
}

/** Stored group flags -> full flag object (unknown/missing flags fall back to "allowed"). */
export function parseGroupFlags(raw: unknown): GroupFlags {
  const parsed = GroupFlagsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : ALL_GROUP_FLAGS;
}

/** Effective permissions: the role's set minus what the operator's group switches off. */
export function sessionPermissions(role: Role, groupId: number | null, groupFlags: unknown): Permission[] {
  return permissionsFor(role, groupId === null ? null : parseGroupFlags(groupFlags));
}

export function buildSessionUser(row: SessionUserRow, impersonation: ImpersonationInfo | null = null): SessionUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    extension: row.extension,
    email: row.email,
    groupId: row.groupId,
    permissions: sessionPermissions(row.role, row.groupId, row.groupPermissions),
    mustChangePassword: Boolean(row.mustChangePassword),
    impersonation: impersonation ? { by: impersonation.by, expiresAt: impersonation.expiresAt.toISOString() } : null,
  };
}
