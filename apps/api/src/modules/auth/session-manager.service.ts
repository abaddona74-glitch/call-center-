import { type Role, type SessionInfo } from '@cc/shared';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { type DbHost, InjectDb } from '../../database/db.js';
import { RealtimeService } from '../realtime/realtime.service.js';

export interface SessionRow {
  id: string;
  userId: number;
  username: string;
  role: Role;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  passkeyId: string | null;
}

/**
 * Revoking sessions (and closing their WebSockets) and listing them.
 * Extends SessionsService without changing its API.
 */
@Injectable()
export class SessionManager {
  constructor(
    @InjectDb() private readonly txHost: DbHost,
    private readonly realtime: RealtimeService,
  ) {}

  /** Delete sessions of a user (optionally keeping one) and close their sockets. Returns how many ended. */
  async revokeUserSessions(userId: number, reason: string, exceptSessionId?: string): Promise<number> {
    let q = this.txHost.tx.deleteFrom('sessions').where('userId', '=', userId);
    if (exceptSessionId) q = q.where('id', '!=', exceptSessionId);
    const deleted = await q.returning('id').execute();
    for (const { id } of deleted) this.realtime.terminate({ sessionId: id }, reason);
    return deleted.length;
  }

  async revokeSession(sessionId: string, reason: string): Promise<boolean> {
    const res = await this.txHost.tx.deleteFrom('sessions').where('id', '=', sessionId).executeTakeFirst();
    this.realtime.terminate({ sessionId }, reason);
    return Number(res.numDeletedRows ?? 0) > 0;
  }

  /** Delete all passkeys of a user (their passkey sessions go with them via FK). */
  async revokeUserPasskeys(userId: number, reason: string): Promise<number> {
    const sessions = await this.txHost.tx
      .selectFrom('sessions')
      .select('id')
      .where('userId', '=', userId)
      .where('passkeyId', 'is not', null)
      .execute();
    const res = await this.txHost.tx.deleteFrom('passkeys').where('userId', '=', userId).executeTakeFirst();
    for (const { id } of sessions) this.realtime.terminate({ sessionId: id }, reason);
    return Number(res.numDeletedRows ?? 0);
  }

  /** Close sockets of a user without ending the sessions (role change: clients reconnect with fresh data). */
  refreshSockets(userId: number, reason: string): void {
    this.realtime.terminate({ userId }, reason);
  }

  async findSession(sessionId: string): Promise<SessionRow | undefined> {
    return this.baseQuery().where('s.id', '=', sessionId).executeTakeFirst();
  }

  async listActive(filter: { userId?: number; roles?: Role[] } = {}): Promise<SessionRow[]> {
    let q = this.baseQuery();
    if (filter.userId !== undefined) q = q.where('s.userId', '=', filter.userId);
    if (filter.roles) q = q.where('u.role', 'in', filter.roles);
    return q.orderBy('s.lastSeenAt', 'desc').limit(1000).execute();
  }

  toInfo(row: SessionRow, currentSessionId: string | undefined, canRevoke: boolean): SessionInfo {
    const isCurrent = row.id === currentSessionId;
    return {
      id: row.id,
      userId: row.userId,
      username: row.username,
      role: row.role,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      viaPasskey: row.passkeyId !== null,
      isCurrent,
      canRevoke: canRevoke && !isCurrent,
    };
  }

  private baseQuery() {
    return this.txHost.tx
      .selectFrom('sessions as s')
      .innerJoin('users as u', 'u.id', 's.userId')
      .select([
        's.id',
        's.userId',
        'u.username',
        'u.role',
        's.ip',
        's.userAgent',
        's.createdAt',
        's.lastSeenAt',
        's.expiresAt',
        's.passkeyId',
      ])
      .where('s.expiresAt', '>', sql<Date>`now()`);
  }
}
