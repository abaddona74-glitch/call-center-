import { createHash, randomBytes } from 'node:crypto';
import type { SessionUser } from '@cc/shared';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'kysely';
import { AppConfig } from '../../config/app-config.js';
import { type DbHost, InjectDb } from '../../database/db.js';
import { buildSessionUser } from './domain/session-user.js';

export function sessionIdFromToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface ValidatedSession {
  sessionId: string;
  user: SessionUser;
}

const TOUCH_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectDb() private readonly txHost: DbHost,
    private readonly config: AppConfig,
  ) {}

  get ttlMs(): number {
    return this.config.get('SESSION_TTL_HOURS') * 3_600_000;
  }

  async create(
    userId: number,
    meta: {
      ip?: string;
      userAgent?: string;
      passkeyId?: string;
      /** "Log in as": the superuser and their own session; such sessions are short-lived. */
      impersonation?: { byUserId: number; parentSessionId: string; ttlMs: number };
    },
  ): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const sessionId = sessionIdFromToken(token);
    const expiresAt = new Date(Date.now() + (meta.impersonation?.ttlMs ?? this.ttlMs));
    await this.txHost.tx
      .insertInto('sessions')
      .values({
        id: sessionId,
        userId,
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        passkeyId: meta.passkeyId ?? null,
        impersonatorUserId: meta.impersonation?.byUserId ?? null,
        parentSessionId: meta.impersonation?.parentSessionId ?? null,
      })
      .execute();
    return { token, sessionId, expiresAt };
  }

  async validate(token: string | undefined | null): Promise<ValidatedSession | null> {
    if (!token || token.length > 200) return null;
    const sessionId = sessionIdFromToken(token);
    const row = await this.txHost.tx
      .selectFrom('sessions as s')
      .innerJoin('users as u', 'u.id', 's.userId')
      .leftJoin('operatorGroups as g', 'g.id', 'u.groupId')
      .leftJoin('users as iu', 'iu.id', 's.impersonatorUserId')
      .leftJoin('sessions as ps', 'ps.id', 's.parentSessionId')
      .select([
        's.id as sessionId',
        's.lastSeenAt',
        's.expiresAt',
        's.impersonatorUserId',
        'iu.username as impersonatorUsername',
        'u.id',
        'u.username',
        'u.role',
        'u.extension',
        'u.email',
        'u.groupId',
        'u.mustChangePassword',
        'g.permissions as groupPermissions',
      ])
      .where('s.id', '=', sessionId)
      .where('s.expiresAt', '>', sql<Date>`now()`)
      .where('u.isActive', '=', true)
      // An impersonation lives only while the superuser's own session does and they are still an active superuser.
      .where((eb) =>
        eb.or([
          eb('s.impersonatorUserId', 'is', null),
          eb.and([
            eb('ps.expiresAt', '>', sql<Date>`now()`),
            eb('iu.isActive', '=', true),
            eb('iu.role', '=', 'superuser'),
          ]),
        ]),
      )
      .executeTakeFirst();
    if (!row) return null;

    if (Date.now() - new Date(row.lastSeenAt).getTime() > TOUCH_INTERVAL_MS) {
      this.txHost.tx
        .updateTable('sessions')
        .set({ lastSeenAt: sql`now()` })
        .where('id', '=', sessionId)
        .execute()
        .catch((err: unknown) => this.logger.warn(`session touch failed: ${String(err)}`));
    }

    const impersonation =
      row.impersonatorUserId !== null && row.impersonatorUsername
        ? { by: { id: row.impersonatorUserId, username: row.impersonatorUsername }, expiresAt: new Date(row.expiresAt) }
        : null;
    return { sessionId: row.sessionId, user: buildSessionUser(row, impersonation) };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.txHost.tx.deleteFrom('sessions').where('id', '=', sessionId).execute();
  }

  async revokeAllForUser(userId: number, exceptSessionId?: string): Promise<number> {
    let q = this.txHost.tx.deleteFrom('sessions').where('userId', '=', userId);
    if (exceptSessionId) q = q.where('id', '!=', exceptSessionId);
    const res = await q.executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<void> {
    const res = await this.txHost.tx
      .deleteFrom('sessions')
      .where('expiresAt', '<=', sql<Date>`now()`)
      .executeTakeFirst();
    const n = Number(res.numDeletedRows ?? 0);
    if (n > 0) this.logger.log(`purged ${n} expired sessions`);
  }
}
