import type { Role } from '@cc/shared';
import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

export interface UsersTable {
  id: Generated<number>;
  username: string;
  /** `scrypt$N$r$p$salt$hashHex` — see password-hasher.ts */
  passwordHash: string;
  role: Role;
  extension: string | null;
  email: string | null;
  isActive: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface SessionsTable {
  /** sha256(token), hex */
  id: string;
  userId: number;
  createdAt: Generated<Date>;
  expiresAt: Date;
  lastSeenAt: Generated<Date>;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditLogTable {
  id: Generated<number>;
  at: Generated<Date>;
  actorUserId: number | null;
  actorLabel: string;
  action: string;
  target: string | null;
  details: unknown | null;
  ip: string | null;
  requestId: string | null;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

declare module '../../database/db.js' {
  interface DB {
    users: UsersTable;
    sessions: SessionsTable;
    auditLog: AuditLogTable;
  }
}
