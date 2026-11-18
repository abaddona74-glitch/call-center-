import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LockoutSettings } from '@cc/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../../../database/db.js';
import { type LegacySources, openLegacySources } from '../legacy-sources.js';
import { MapperReportSchema, type MigrationContext } from '../mapper.js';
import { createSettingsMapper, lockoutFromLegacy, type SettingsRepository } from './settings.mapper.js';

const SCHEMA = readFileSync(path.join(import.meta.dirname, '..', '__fixtures__', 'legacy-schema.sql'), 'utf8');

function createLegacy(settings: Record<string, string>, json = true): { legacy: LegacySources; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'cc-migrate-settings-'));
  const file = path.join(dir, 'callcenter.db');
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const insert = db.prepare(
    `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, '2026-10-14 12:41:17')`,
  );
  for (const [k, v] of Object.entries(settings)) insert.run(k, v);
  db.close();
  if (json) {
    writeFileSync(path.join(dir, 'queue-sync-settings.json'), JSON.stringify({ enabled: true, mode: 'grandTotal' }));
    writeFileSync(path.join(dir, 'system_settings.json'), JSON.stringify({ autoRecoverVms: false }));
  }
  const legacy = openLegacySources({ sqlitePath: file, dataDir: dir });
  return {
    legacy,
    cleanup: () => {
      legacy.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

class InMemorySettingsRepository implements SettingsRepository {
  constructor(public lockout: unknown = undefined) {}
  inserted: { value: LockoutSettings; updatedAt: Date | null } | null = null;
  async currentLockout() {
    return this.lockout;
  }
  async insertLockoutIfAbsent(value: LockoutSettings, updatedAt: Date | null) {
    if (this.lockout !== undefined) return false;
    this.lockout = value;
    this.inserted = { value, updatedAt };
    return true;
  }
}

const PROD_LIKE = {
  auth_lockout_threshold: '5',
  auth_lockout_duration_min: '60',
  excluded_operators: '["118","1111"]',
};

describe('settings mapper', () => {
  const cleanups: Array<() => void> = [];
  afterAll(() => cleanups.forEach((c) => c()));
  const ctx = (settings: Record<string, string>, dryRun = false, json = true): MigrationContext => {
    const { legacy, cleanup } = createLegacy(settings, json);
    cleanups.push(cleanup);
    return { legacy, db: {} as Kysely<DB>, dryRun, logger: { info: () => undefined, warn: () => undefined } };
  };

  describe('lockoutFromLegacy', () => {
    const row = (key: string, value: string | null) => ({ key, value, updated_at: '2026-10-14 12:41:17' });

    it('reads the legacy policy; the IP limit keeps the new default', () => {
      const r = lockoutFromLegacy([row('auth_lockout_threshold', '5'), row('auth_lockout_duration_min', '60')]);
      expect(r.value).toEqual({ maxAttempts: 5, lockoutMinutes: 60, ipMaxAttempts: 30 });
      expect(r.updatedAt?.toISOString()).toBe('2026-10-14T07:41:17.000Z');
      expect(r.warnings).toEqual([]);
    });

    it('clamps and defaults exactly like legacy authService', () => {
      const r = lockoutFromLegacy([row('auth_lockout_threshold', '25'), row('auth_lockout_duration_min', 'abc')]);
      expect(r.value).toMatchObject({ maxAttempts: 10, lockoutMinutes: 60 });
      expect(r.warnings).toEqual([
        'auth_lockout_threshold 25 clamped to 10 (as legacy did)',
        'auth_lockout_duration_min "abc" is not a number; legacy default 60',
      ]);
      expect(lockoutFromLegacy([row('auth_lockout_threshold', '1')]).value).toMatchObject({
        maxAttempts: 3,
        lockoutMinutes: 60,
      });
      expect(lockoutFromLegacy([row('auth_lockout_duration_min', '5000')]).value.lockoutMinutes).toBe(1440);
    });
  });

  describe('run', () => {
    it('migrates the lockout policy, leaves excluded_operators to S11, and says why the JSON files stay', async () => {
      const repo = new InMemorySettingsRepository();
      const report = await createSettingsMapper(() => repo).run(ctx(PROD_LIKE));
      expect(MapperReportSchema.parse(report)).toEqual(report);
      expect(report).toMatchObject({ name: 'settings', status: 'ok', read: 4, inserted: 1, unchanged: 0 });
      expect(report.skipped).toEqual([]);
      expect(report.warnings).toEqual([]);
      expect(repo.inserted?.value).toEqual({ maxAttempts: 5, lockoutMinutes: 60, ipMaxAttempts: 30 });
      expect(report.notes).toEqual([
        'queue-sync-settings.json: not migrated — no counterpart in the new system (operator cards show Asterisk callsTaken as is; no "DB sync" mode)',
        'system_settings.json: not migrated — the Proxmox VM auto-recovery watchdog is removed',
        'system_settings.excluded_operators: migrated by the excluded-operators mapper (S11), not here',
        'lockout policy from legacy: 5 attempts, 60 min, IP 30 attempts (IP limit is the new default)',
      ]);
    });

    it('dry-run plans without writing', async () => {
      const repo = new InMemorySettingsRepository();
      const report = await createSettingsMapper(() => repo).run(ctx(PROD_LIKE, true));
      expect(report.inserted).toBe(1);
      expect(repo.lockout).toBeUndefined();
    });

    it('never overwrites a policy set in the new system; a re-run is unchanged', async () => {
      const same = new InMemorySettingsRepository({ maxAttempts: 5, lockoutMinutes: 60, ipMaxAttempts: 50 });
      expect(await createSettingsMapper(() => same).run(ctx(PROD_LIKE))).toMatchObject({
        inserted: 0,
        unchanged: 1,
        warnings: [],
      });

      const changed = new InMemorySettingsRepository({ maxAttempts: 4, lockoutMinutes: 15, ipMaxAttempts: 30 });
      const report = await createSettingsMapper(() => changed).run(ctx(PROD_LIKE));
      expect(report).toMatchObject({ inserted: 0, unchanged: 1 });
      expect(report.warnings).toEqual([
        {
          key: 'auth_settings.lockout',
          reason:
            'already set in the new system (4 attempts, 15 min, IP 30 attempts); left untouched (legacy: 5 attempts, 60 min, IP 30 attempts)',
        },
      ]);
      expect(changed.lockout).toEqual({ maxAttempts: 4, lockoutMinutes: 15, ipMaxAttempts: 30 });
    });

    it('reports unknown keys and keeps the new default when legacy has no lockout keys', async () => {
      const repo = new InMemorySettingsRepository();
      const report = await createSettingsMapper(() => repo).run(ctx({ some_flag: '1' }, false, false));
      expect(report.skipped).toEqual([
        { key: 'system_settings.some_flag', reason: 'unknown legacy setting; not migrated' },
      ]);
      expect(report.inserted).toBe(0);
      expect(report.notes).toContain('no lockout settings in legacy: the new default policy stays');
    });
  });
});
