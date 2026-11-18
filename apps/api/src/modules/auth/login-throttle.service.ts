import type { LockoutEntry, LockoutKind } from '@cc/shared';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'kysely';
import { type DbHost, InjectDb } from '../../database/db.js';
import { AuthSettingsService } from './auth-settings.service.js';
import {
  applyFailure,
  normalizeLoginName,
  policyFromSettings,
  retryAfterSeconds,
  throttleKeys,
  type ThrottleState,
} from './domain/login-throttle.js';

export interface ThrottleCheckOptions {
  /** Skip the per-username delay (request comes from the user's last successful login address). */
  skipUserDelay?: boolean;
}

/** Thrown when an attempt is blocked; carries Retry-After seconds. */
export class LoginBlockedException extends HttpException {
  constructor(readonly retryAfter: number) {
    super(
      { message: `Too many failed attempts. Try again in ${retryAfter} s`, retryAfterSeconds: retryAfter },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Failed password attempts per username+IP, per IP and per username (rules: domain/login-throttle.ts).
 * Used by password login and by every endpoint that re-checks the current password.
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);

  constructor(
    @InjectDb() private readonly txHost: DbHost,
    private readonly settings: AuthSettingsService,
  ) {}

  /** Throws LoginBlockedException when the attempt must wait. Does not count anything. */
  async assertAllowed(username: string, ip: string, opts: ThrottleCheckOptions = {}): Promise<void> {
    const keys = throttleKeys(username, ip);
    const kinds: LockoutKind[] = opts.skipUserDelay ? ['user_ip', 'ip'] : ['user_ip', 'ip', 'user'];
    const rows = await this.txHost.tx
      .selectFrom('authLoginThrottle')
      .select(['kind', 'lockedUntil'])
      .where((eb) => eb.or(kinds.map((k) => eb.and([eb('kind', '=', k), eb('key', '=', keys[k])]))))
      .execute();
    const now = new Date();
    const wait = Math.max(0, ...rows.map((r) => retryAfterSeconds(r, now)));
    if (wait > 0) throw new LoginBlockedException(wait);
  }

  /**
   * Count one failed attempt. Returns how many more attempts this username+IP has before it is
   * locked (0 = the next attempt will be refused). Same numbers for existing and unknown usernames.
   */
  async registerFailure(username: string, ip: string): Promise<number> {
    const policy = policyFromSettings(await this.settings.getLockout());
    let remaining = policy.maxAttempts;
    const keys = throttleKeys(username, ip);
    const name = normalizeLoginName(username);
    const now = new Date();
    for (const kind of ['user_ip', 'ip', 'user'] as const) {
      const prev = await this.txHost.tx
        .selectFrom('authLoginThrottle')
        .select(['failures', 'lockCount', 'lockedUntil', 'firstFailureAt', 'lastFailureAt'])
        .where('kind', '=', kind)
        .where('key', '=', keys[kind])
        .executeTakeFirst();
      const next: ThrottleState = applyFailure(kind, prev, policy, now);
      if (kind === 'user_ip')
        remaining = next.lockedUntil && next.lockedUntil > now ? 0 : policy.maxAttempts - next.failures;
      const values = {
        failures: next.failures,
        lockCount: next.lockCount,
        lockedUntil: next.lockedUntil,
        firstFailureAt: next.firstFailureAt,
        lastFailureAt: next.lastFailureAt,
      };
      await this.txHost.tx
        .insertInto('authLoginThrottle')
        .values({
          kind,
          key: keys[kind],
          username: kind === 'ip' ? null : name,
          ip: kind === 'user' ? null : ip,
          ...values,
        })
        .onConflict((oc) => oc.columns(['kind', 'key']).doUpdateSet(values))
        .execute();
      if (next.lockedUntil && (!prev?.lockedUntil || prev.lockedUntil < now) && kind !== 'user') {
        this.logger.warn(
          `login lockout: ${kind} ${kind === 'ip' ? ip : `${name}@${ip}`} until ${next.lockedUntil.toISOString()}`,
        );
      }
    }
    return remaining;
  }

  /** Successful login: forget this user's failures (the IP counter is kept on purpose). */
  async registerSuccess(username: string, ip: string): Promise<void> {
    const keys = throttleKeys(username, ip);
    await this.txHost.tx
      .deleteFrom('authLoginThrottle')
      .where((eb) =>
        eb.or([
          eb.and([eb('kind', '=', 'user_ip'), eb('key', '=', keys.user_ip)]),
          eb.and([eb('kind', '=', 'user'), eb('key', '=', keys.user)]),
        ]),
      )
      .execute();
  }

  /** Clear every counter of a username (after an admin unlock or a completed password reset). */
  async clearUser(username: string): Promise<number> {
    const name = normalizeLoginName(username);
    const res = await this.txHost.tx.deleteFrom('authLoginThrottle').where('username', '=', name).executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }

  async listLocked(): Promise<LockoutEntry[]> {
    const rows = await this.txHost.tx
      .selectFrom('authLoginThrottle')
      .select(['id', 'kind', 'username', 'ip', 'failures', 'lockCount', 'lockedUntil', 'lastFailureAt'])
      .where('lockedUntil', '>', sql<Date>`now()`)
      .orderBy('lockedUntil', 'desc')
      .limit(500)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      username: r.username,
      ip: r.ip,
      failures: r.failures,
      lockedUntil: r.lockedUntil!.toISOString(),
      lastFailureAt: r.lastFailureAt.toISOString(),
    }));
  }

  async findById(
    id: number,
  ): Promise<{ id: number; kind: LockoutKind; username: string | null; ip: string | null } | undefined> {
    return this.txHost.tx
      .selectFrom('authLoginThrottle')
      .select(['id', 'kind', 'username', 'ip'])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async unlock(id: number): Promise<number> {
    const res = await this.txHost.tx.deleteFrom('authLoginThrottle').where('id', '=', id).executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }

  async unlockAll(): Promise<number> {
    const res = await this.txHost.tx
      .deleteFrom('authLoginThrottle')
      .where('lockedUntil', '>', sql<Date>`now()`)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeStale(): Promise<void> {
    await this.txHost.tx
      .deleteFrom('authLoginThrottle')
      .where((eb) => eb.or([eb('lockedUntil', 'is', null), eb('lockedUntil', '<', sql<Date>`now()`)]))
      .where('lastFailureAt', '<', sql<Date>`now() - interval '2 days'`)
      .execute();
  }
}
