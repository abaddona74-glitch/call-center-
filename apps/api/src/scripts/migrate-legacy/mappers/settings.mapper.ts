import { DEFAULT_LOCKOUT_SETTINGS, type LockoutSettings, LockoutSettingsSchema } from '@cc/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../../../database/db.js';
import { emptyReport, type Mapper } from '../mapper.js';
import { parseLegacyLocalTime } from '../time.js';

/**
 * Legacy settings (docs/rewrite/legacy/data.md §1.1.11, §2.1; owner S1).
 *
 * - SQLite `system_settings` `auth_lockout_threshold` / `auth_lockout_duration_min` → `auth_settings` key
 *   `lockout` (`LockoutSettingsSchema`, packages/shared/src/security.ts): `maxAttempts` / `lockoutMinutes`, read
 *   the way legacy did (parseInt; threshold clamped 3–10, default 5; duration ≥ 1, default 60; the new maximum
 *   is 1440). `ipMaxAttempts` has no legacy counterpart and keeps the new default. Owner decision 2026-11-18:
 *   "lockout as in legacy: 5 attempts, 60 minutes".
 * - `excluded_operators` is not handled here: the `excluded-operators` mapper (S11) migrates it.
 * - Any other key is reported as unknown and not migrated.
 * - `queue-sync-settings.json` is not migrated: the new system has no counterpart. Legacy used it to replace
 *   Asterisk's queue `callsTaken` with a CDR-based count (plus manual offsets) on the operator cards; the new
 *   system shows Asterisk's `callsTaken` as is and has no "DB sync" mode or manual adjustment.
 * - `system_settings.json` (Proxmox VM auto-recovery) is not migrated: the watchdog is removed.
 *
 * Idempotency: insert-if-absent by key. A lockout policy already set in the new system is never overwritten;
 * a warning says how it differs from legacy.
 */

const LEGACY_DEFAULTS = { threshold: 5, durationMin: 60 } as const;
const LOCKOUT_KEYS = ['auth_lockout_threshold', 'auth_lockout_duration_min'] as const;
const NOT_MINE = new Set(['excluded_operators']);

export interface LegacySettingRow {
  key: string;
  value: string | null;
  updated_at: string | null;
}

/** Pure: legacy lockout settings → the new policy, read exactly like legacy authService did. */
export function lockoutFromLegacy(rows: readonly LegacySettingRow[]): {
  value: LockoutSettings;
  updatedAt: Date | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const get = (key: string) => rows.find((r) => r.key === key);
  const int = (key: string, fallback: number) => {
    const raw = get(key)?.value;
    const n = Number.parseInt(raw ?? '', 10);
    if (raw === undefined || raw === null) warnings.push(`${key} not set in legacy; legacy default ${fallback}`);
    else if (Number.isNaN(n))
      warnings.push(`${key} ${JSON.stringify(raw.slice(0, 16))} is not a number; legacy default ${fallback}`);
    return Number.isNaN(n) ? fallback : n;
  };

  const threshold = int('auth_lockout_threshold', LEGACY_DEFAULTS.threshold);
  const maxAttempts = Math.min(10, Math.max(3, threshold));
  if (maxAttempts !== threshold)
    warnings.push(`auth_lockout_threshold ${threshold} clamped to ${maxAttempts} (as legacy did)`);
  const duration = int('auth_lockout_duration_min', LEGACY_DEFAULTS.durationMin);
  const lockoutMinutes = Math.min(1440, Math.max(1, duration));
  if (lockoutMinutes !== duration) {
    warnings.push(`auth_lockout_duration_min ${duration} clamped to ${lockoutMinutes} (allowed 1–1440)`);
  }

  const value = LockoutSettingsSchema.parse({
    maxAttempts,
    lockoutMinutes,
    ipMaxAttempts: DEFAULT_LOCKOUT_SETTINGS.ipMaxAttempts,
  });
  const times = LOCKOUT_KEYS.map((k) => parseLegacyLocalTime(get(k)?.updated_at)).filter((d): d is Date => d !== null);
  const updatedAt = times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
  return { value, updatedAt, warnings };
}

export interface SettingsRepository {
  /** The current `auth_settings.lockout` value, or undefined when not set. */
  currentLockout(): Promise<unknown>;
  /** Inserts unless the key exists; returns whether it was inserted. */
  insertLockoutIfAbsent(value: LockoutSettings, updatedAt: Date | null): Promise<boolean>;
}

export class KyselySettingsRepository implements SettingsRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async currentLockout(): Promise<unknown> {
    const row = await this.db
      .selectFrom('authSettings')
      .select('value')
      .where('key', '=', 'lockout')
      .executeTakeFirst();
    return row?.value;
  }

  async insertLockoutIfAbsent(value: LockoutSettings, updatedAt: Date | null): Promise<boolean> {
    const row = await this.db
      .insertInto('authSettings')
      .values({
        key: 'lockout',
        value: JSON.stringify(value),
        updatedAt: updatedAt ?? sql<Date>`now()`,
        updatedBy: null,
      })
      .onConflict((oc) => oc.column('key').doNothing())
      .returning('key')
      .executeTakeFirst();
    return Boolean(row);
  }
}

export function createSettingsMapper(
  repositoryFor: (db: Kysely<DB>) => SettingsRepository = (db) => new KyselySettingsRepository(db),
): Mapper {
  const meta = { name: 'settings', owner: 'S1' };
  return {
    ...meta,
    async run(ctx) {
      const report = emptyReport(meta);

      // JSON files: counted, never migrated.
      const files = [
        {
          file: 'queue-sync-settings.json',
          why: 'no counterpart in the new system (operator cards show Asterisk callsTaken as is; no "DB sync" mode)',
        },
        { file: 'system_settings.json', why: 'the Proxmox VM auto-recovery watchdog is removed' },
      ];
      for (const { file, why } of files) {
        const src = ctx.legacy.readJson(file);
        if (src.status === 'ok') {
          report.read++;
          report.notes.push(`${file}: not migrated — ${why}`);
        } else {
          report.notes.push(
            `${file}: ${src.status === 'invalid' ? 'not valid JSON' : 'not found'}; not migrated anyway — ${why}`,
          );
        }
      }

      const sqlite = ctx.legacy.sqlite;
      if (!sqlite?.hasTable('system_settings')) {
        report.notes.push(sqlite ? 'legacy table system_settings not found' : '--sqlite not given');
        if (report.read === 0) report.status = 'source-missing';
        return report;
      }
      const rows = sqlite.all('SELECT key, value, updated_at FROM system_settings ORDER BY key').map((r) => ({
        key: String(r.key),
        value: r.value === null ? null : String(r.value),
        updated_at: r.updated_at === null ? null : String(r.updated_at),
      }));
      for (const r of rows) {
        if (NOT_MINE.has(r.key)) {
          report.notes.push(`system_settings.${r.key}: migrated by the excluded-operators mapper (S11), not here`);
          continue;
        }
        report.read++;
        if (!(LOCKOUT_KEYS as readonly string[]).includes(r.key)) {
          report.skipped.push({
            key: `system_settings.${r.key.slice(0, 40)}`,
            reason: 'unknown legacy setting; not migrated',
          });
        }
      }

      if (!rows.some((r) => (LOCKOUT_KEYS as readonly string[]).includes(r.key))) {
        report.notes.push('no lockout settings in legacy: the new default policy stays');
        return report;
      }
      const lockout = lockoutFromLegacy(rows);
      for (const w of lockout.warnings) report.warnings.push({ key: 'auth_settings.lockout', reason: w });

      const repo = repositoryFor(ctx.db);
      const current = await repo.currentLockout();
      const shown = (v: LockoutSettings) =>
        `${v.maxAttempts} attempts, ${v.lockoutMinutes} min, IP ${v.ipMaxAttempts} attempts`;
      if (current !== undefined) {
        report.unchanged++;
        const parsed = LockoutSettingsSchema.safeParse(current);
        const same =
          parsed.success &&
          parsed.data.maxAttempts === lockout.value.maxAttempts &&
          parsed.data.lockoutMinutes === lockout.value.lockoutMinutes;
        if (!same) {
          report.warnings.push({
            key: 'auth_settings.lockout',
            reason: `already set in the new system${parsed.success ? ` (${shown(parsed.data)})` : ''}; left untouched (legacy: ${shown(lockout.value)})`,
          });
        }
      } else if (ctx.dryRun) {
        report.inserted++;
      } else if (await repo.insertLockoutIfAbsent(lockout.value, lockout.updatedAt)) {
        report.inserted++;
      } else {
        report.unchanged++;
        report.warnings.push({ key: 'auth_settings.lockout', reason: 'was set while migrating; left untouched' });
      }
      report.notes.push(`lockout policy from legacy: ${shown(lockout.value)} (IP limit is the new default)`);
      return report;
    },
  };
}

export const settingsMapper = createSettingsMapper();
