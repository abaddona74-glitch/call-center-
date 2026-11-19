import { type Role, type SessionUser, permissionsFor } from '@cc/shared';

export interface SessionUserRow {
  id: number;
  username: string;
  role: Role;
  extension: string | null;
  email: string | null;
  mustChangePassword?: boolean;
}

export interface ImpersonationInfo {
  by: { id: number; username: string };
  expiresAt: Date;
}

export function buildSessionUser(row: SessionUserRow, impersonation: ImpersonationInfo | null = null): SessionUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    extension: row.extension,
    email: row.email,
    permissions: permissionsFor(row.role),
    mustChangePassword: Boolean(row.mustChangePassword),
    impersonation: impersonation ? { by: impersonation.by, expiresAt: impersonation.expiresAt.toISOString() } : null,
  };
}
