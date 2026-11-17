import { DEFAULT_LOCKOUT_SETTINGS, type LockoutSettings, LockoutSettingsSchema } from '@cc/shared';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls/app-cls.js';
import { type DbHost, InjectDb } from '../../database/db.js';

const LOCKOUT_KEY = 'lockout';
const CACHE_MS = 30_000;

/** Auth module settings (table auth_settings, jsonb per key), cached briefly in memory. */
@Injectable()
export class AuthSettingsService {
  private cache: { value: LockoutSettings; at: number } | null = null;

  constructor(
    @InjectDb() private readonly txHost: DbHost,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async getLockout(): Promise<LockoutSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.txHost.tx
      .selectFrom('authSettings')
      .select('value')
      .where('key', '=', LOCKOUT_KEY)
      .executeTakeFirst();
    const parsed = LockoutSettingsSchema.safeParse(row?.value);
    const value = parsed.success ? parsed.data : DEFAULT_LOCKOUT_SETTINGS;
    this.cache = { value, at: Date.now() };
    return value;
  }

  async setLockout(value: LockoutSettings): Promise<LockoutSettings> {
    const updatedBy = this.cls.isActive() ? (this.cls.get('user')?.id ?? null) : null;
    const json = JSON.stringify(value);
    await this.txHost.tx
      .insertInto('authSettings')
      .values({ key: LOCKOUT_KEY, value: json, updatedBy })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: json, updatedBy, updatedAt: sql`now()` }))
      .execute();
    this.cache = null;
    return value;
  }
}
