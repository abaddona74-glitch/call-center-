import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DB } from '../../../database/db.js';
import { createDb } from '../../../database/kysely.js';
import { createMigrator } from '../../../database/migrator.js';
import '../../../modules/excluded-operators/excluded-operators.tables.js';
import { openLegacySources } from '../legacy-sources.js';
import { type MapperReport, MapperReportSchema } from '../mapper.js';
import { createExcludedOperatorsMapper } from './excluded-operators.mapper.js';

const SCHEMA = readFileSync(path.join(import.meta.dirname, '..', '__fixtures__', 'legacy-schema.sql'), 'utf8');

/** A synthetic legacy callcenter.db with the given `system_settings.excluded_operators` value. */
function legacyDb(dir: string, name: string, value: string | null): string {
  const file = path.join(dir, `${name}.db`);
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run('auth_lockout_threshold', '5');
  if (value !== null)
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run('excluded_operators', value);
  db.close();
  return file;
}

describe('excluded-operators mapper (e2e, real Postgres)', () => {
  let db: Kysely<DB>;
  let dir: string;
  let prod: string;
  let userId: number;

  const stored = async () =>
    db
      .selectFrom('excludedOperators')
      .select(['extensions', 'updatedByUserId'])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
  const reset = (extensions: string[] = [], by: number | null = null) =>
    db
      .updateTable('excludedOperators')
      .set({ extensions: sql<string[]>`${sql.val(extensions)}::text[]`, updatedByUserId: by })
      .where('id', '=', 1)
      .execute();

  async function run(sqlitePath: string | undefined, dryRun: boolean): Promise<MapperReport> {
    const legacy = openLegacySources({ sqlitePath, dataDir: undefined });
    const mapper = createExcludedOperatorsMapper();
    const logger = { info: () => {}, warn: () => {} };
    try {
      return await db.transaction().execute(async (trx) => {
        const report = await mapper.run({ legacy, db: trx, dryRun, logger });
        if (dryRun) throw Object.assign(new Error('rollback'), { report });
        return report;
      });
    } catch (err) {
      const report = (err as { report?: MapperReport }).report;
      if (report) return MapperReportSchema.parse(report);
      throw err;
    } finally {
      legacy.close();
    }
  }

  beforeAll(async () => {
    const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error('Set E2E_DATABASE_URL');
    db = createDb({ connectionString: url, max: 2 });
    const { error } = await createMigrator(db).migrateToLatest();
    if (error) throw error;
    await reset();
    userId = (
      await db
        .insertInto('users')
        .values({ username: `s11_mapper_${randomBytes(4).toString('hex')}`, passwordHash: 'x', role: 'superuser' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    dir = mkdtempSync(path.join(tmpdir(), 'cc-s11-mapper-'));
    prod = legacyDb(dir, 'prod', '["118","1111"]');
  });

  afterAll(async () => {
    await reset();
    await db?.deleteFrom('users').where('id', '=', userId).execute();
    await db?.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a missing source', async () => {
    expect(await run(undefined, true)).toMatchObject({ status: 'source-missing', notes: ['--sqlite not given'] });
  });

  it('dry-run plans without writing', async () => {
    const r = await run(prod, true);
    expect(r).toMatchObject({ status: 'ok', read: 2, inserted: 2, unchanged: 0, errors: [] });
    expect((await stored()).extensions).toEqual([]);
  });

  it('moves 118 and 1111 into the new list', async () => {
    const r = await run(prod, false);
    expect(r).toMatchObject({ status: 'ok', read: 2, inserted: 2, unchanged: 0, skipped: [], warnings: [] });
    expect(await stored()).toEqual({ extensions: ['118', '1111'], updatedByUserId: null });
  });

  it('is idempotent', async () => {
    expect(await run(prod, false)).toMatchObject({ read: 2, inserted: 0, unchanged: 2 });
    expect((await stored()).extensions).toEqual(['118', '1111']);
  });

  it('adds to the list but never removes; skips entries that are not extensions', async () => {
    await reset(['205']);
    const messy = legacyDb(dir, 'messy', '[118, " 1111 ", "SIP/1", null]');
    const r = await run(messy, false);
    expect(r).toMatchObject({ read: 4, inserted: 2, unchanged: 0 });
    expect(r.skipped.map((s) => s.key)).toEqual(['excluded_operators[2]', 'excluded_operators[3]']);
    expect((await stored()).extensions).toEqual(['118', '205', '1111']);
  });

  it('leaves a list edited in the new system alone and warns', async () => {
    await reset(['118'], userId);
    const r = await run(prod, false);
    expect(r).toMatchObject({ inserted: 0, unchanged: 1 });
    expect(r.warnings).toEqual([expect.objectContaining({ key: '1111' })]);
    expect(await stored()).toEqual({ extensions: ['118'], updatedByUserId: userId });
  });

  it('nothing to do when legacy has no list; fails (rolled back) on a broken value', async () => {
    await reset();
    expect(await run(legacyDb(dir, 'none', null), false)).toMatchObject({ status: 'ok', read: 0, inserted: 0 });
    const broken = await run(legacyDb(dir, 'broken', '118,1111'), false);
    expect(broken).toMatchObject({
      status: 'failed',
      errors: [expect.objectContaining({ key: 'excluded_operators' })],
    });
    expect((await stored()).extensions).toEqual([]);
  });
});
