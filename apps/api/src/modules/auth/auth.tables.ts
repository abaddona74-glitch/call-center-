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
  /** WebAuthn user handle (uuid). Legacy-compatible: the handle bytes are the UTF-8 of this string. */
  webauthnUserId: Generated<string>;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  /** Only /auth/me, /auth/password and logout work until the password is changed. */
  mustChangePassword: Generated<boolean>;
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
  /** Set when the session was opened with a passkey (deleted together with it). */
  passkeyId: Generated<string | null>;
  /** "Log in as": the superuser acting as `userId` in this session. */
  impersonatorUserId: Generated<number | null>;
  /** "Log in as": the superuser's own session; this one is valid only while that one is. */
  parentSessionId: Generated<string | null>;
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

export type ThrottleKind = 'user_ip' | 'ip' | 'user';

export interface AuthLoginThrottleTable {
  id: Generated<number>;
  kind: ThrottleKind;
  key: string;
  username: string | null;
  ip: string | null;
  failures: number;
  lockCount: number;
  lockedUntil: Date | null;
  firstFailureAt: Date;
  lastFailureAt: Date;
}

export interface AuthSettingsTable {
  key: string;
  value: unknown;
  updatedAt: Generated<Date>;
  updatedBy: number | null;
}

export type AuthCodePurpose = 'password_reset' | 'email_current' | 'email_new';

export interface AuthCodesTable {
  id: Generated<number>;
  userId: number;
  purpose: AuthCodePurpose;
  email: string;
  codeHash: string;
  attempts: Generated<number>;
  expiresAt: Date;
  consumedAt: Date | null;
  newEmail: string | null;
  tokenHash: string | null;
  tokenExpiresAt: Date | null;
  ip: string | null;
  createdAt: Generated<Date>;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

declare module '../../database/db.js' {
  interface DB {
    users: UsersTable;
    sessions: SessionsTable;
    auditLog: AuditLogTable;
    authLoginThrottle: AuthLoginThrottleTable;
    authSettings: AuthSettingsTable;
    authCodes: AuthCodesTable;
  }
}
