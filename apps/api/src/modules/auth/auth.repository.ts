import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { type DbHost, InjectDb } from '../../database/db.js';
import type { AuthCodePurpose } from './auth.tables.js';
import type { SessionUserRow } from './domain/session-user.js';

export interface AuthUserRow extends SessionUserRow {
  passwordHash: string;
  isActive: boolean;
  lastLoginIp: string | null;
  webauthnUserId: string;
}

export interface AuthCodeRow {
  id: number;
  userId: number;
  purpose: AuthCodePurpose;
  email: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  newEmail: string | null;
  tokenHash: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
}

/** Queries of the auth module (users as credentials, one-time codes). */
@Injectable()
export class AuthRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  private userQuery() {
    return this.txHost.tx
      .selectFrom('users as u')
      .leftJoin('operatorGroups as g', 'g.id', 'u.groupId')
      .select([
        'u.id',
        'u.username',
        'u.passwordHash',
        'u.role',
        'u.extension',
        'u.email',
        'u.isActive',
        'u.groupId',
        'u.lastLoginIp',
        'u.webauthnUserId',
        'u.mustChangePassword',
        'g.permissions as groupPermissions',
      ]);
  }

  findByUsername(username: string): Promise<AuthUserRow | undefined> {
    return this.userQuery()
      .where(sql`lower(u.username)`, '=', username.trim().toLowerCase())
      .executeTakeFirst();
  }

  findById(id: number): Promise<AuthUserRow | undefined> {
    return this.userQuery().where('u.id', '=', id).executeTakeFirst();
  }

  findByWebauthnUserId(uuid: string): Promise<AuthUserRow | undefined> {
    return this.userQuery().where('u.webauthnUserId', '=', uuid).executeTakeFirst();
  }

  /** Username (case-insensitive) or bound email (case-insensitive). */
  findByIdentifier(identifier: string): Promise<AuthUserRow | undefined> {
    const v = identifier.trim().toLowerCase();
    return this.userQuery()
      .where((eb) => eb.or([eb(sql`lower(u.username)`, '=', v), eb(sql`lower(u.email)`, '=', v)]))
      .orderBy(sql`lower(u.username) = ${v}`, 'desc')
      .executeTakeFirst();
  }

  async emailTaken(email: string, exceptUserId: number): Promise<boolean> {
    const row = await this.txHost.tx
      .selectFrom('users')
      .select('id')
      .where(sql`lower(email)`, '=', email.toLowerCase())
      .where('id', '!=', exceptUserId)
      .executeTakeFirst();
    return Boolean(row);
  }

  /** The user chose this password (own change or emailed reset), so a forced change is done. */
  async setPassword(userId: number, passwordHash: string): Promise<void> {
    await this.txHost.tx
      .updateTable('users')
      .set({ passwordHash, mustChangePassword: false, updatedAt: sql`now()` })
      .where('id', '=', userId)
      .execute();
  }

  async setEmail(userId: number, email: string | null): Promise<void> {
    await this.txHost.tx
      .updateTable('users')
      .set({ email, updatedAt: sql`now()` })
      .where('id', '=', userId)
      .execute();
  }

  async markLogin(userId: number, ip: string | null): Promise<void> {
    await this.txHost.tx
      .updateTable('users')
      .set({ lastLoginAt: sql`now()`, lastLoginIp: ip })
      .where('id', '=', userId)
      .execute();
  }

  // --- one-time codes -----------------------------------------------------------------

  async latestCode(userId: number, purposes: AuthCodePurpose[]): Promise<AuthCodeRow | undefined> {
    return this.txHost.tx
      .selectFrom('authCodes')
      .select([
        'id',
        'userId',
        'purpose',
        'email',
        'codeHash',
        'attempts',
        'expiresAt',
        'newEmail',
        'tokenHash',
        'tokenExpiresAt',
        'createdAt',
      ])
      .where('userId', '=', userId)
      .where('purpose', 'in', purposes)
      .where('consumedAt', 'is', null)
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  /** Invalidate earlier codes of these purposes, then store the new one. */
  async replaceCode(
    row: {
      userId: number;
      purpose: AuthCodePurpose;
      email: string;
      codeHash: string;
      expiresAt: Date;
      newEmail?: string | null;
      ip?: string | null;
    },
    invalidate: AuthCodePurpose[],
  ): Promise<number> {
    await this.consumeCodes(row.userId, invalidate);
    const inserted = await this.txHost.tx
      .insertInto('authCodes')
      .values({ ...row, newEmail: row.newEmail ?? null, ip: row.ip ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();
    return inserted.id;
  }

  async consumeCodes(userId: number, purposes: AuthCodePurpose[]): Promise<void> {
    await this.txHost.tx
      .updateTable('authCodes')
      .set({ consumedAt: sql`now()` })
      .where('userId', '=', userId)
      .where('purpose', 'in', purposes)
      .where('consumedAt', 'is', null)
      .execute();
  }

  async consumeCode(id: number): Promise<void> {
    await this.txHost.tx
      .updateTable('authCodes')
      .set({ consumedAt: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  /** +1 attempt; returns the new count. */
  async addAttempt(id: number): Promise<number> {
    const row = await this.txHost.tx
      .updateTable('authCodes')
      .set((eb) => ({ attempts: eb('attempts', '+', 1) }))
      .where('id', '=', id)
      .returning('attempts')
      .executeTakeFirstOrThrow();
    return row.attempts;
  }

  async setResetToken(id: number, tokenHash: string, tokenExpiresAt: Date): Promise<void> {
    await this.txHost.tx.updateTable('authCodes').set({ tokenHash, tokenExpiresAt }).where('id', '=', id).execute();
  }

  async findByResetToken(tokenHash: string): Promise<AuthCodeRow | undefined> {
    return this.txHost.tx
      .selectFrom('authCodes')
      .select([
        'id',
        'userId',
        'purpose',
        'email',
        'codeHash',
        'attempts',
        'expiresAt',
        'newEmail',
        'tokenHash',
        'tokenExpiresAt',
        'createdAt',
      ])
      .where('tokenHash', '=', tokenHash)
      .where('purpose', '=', 'password_reset')
      .where('consumedAt', 'is', null)
      .executeTakeFirst();
  }

  async countRecentCodes(userId: number, purpose: AuthCodePurpose, minutes: number): Promise<number> {
    const row = await this.txHost.tx
      .selectFrom('authCodes')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('userId', '=', userId)
      .where('purpose', '=', purpose)
      .where('createdAt', '>', sql<Date>`now() - make_interval(mins => ${minutes})`)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }
}
