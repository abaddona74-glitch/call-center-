import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import type { DB } from '../../../database/db.js';
import { type LegacySources, openLegacySources } from '../legacy-sources.js';
import { MapperReportSchema, type MigrationContext } from '../mapper.js';
import {
  type BlacklistRepository,
  type BlockedNumberValues,
  createBlacklistMapper,
  transformLegacyBlocked,
} from './blacklist.mapper.js';

const SCHEMA = readFileSync(path.join(import.meta.dirname, '..', '__fixtures__', 'legacy-schema.sql'), 'utf8');

/** Synthetic numbers only. */
const ROWS: Array<[number: string, variants: string, note: string | null]> = [
  ['998900000001', '["998900000001","900000001"]', 'Asterisk 114'], // #1
  ['712345678', '["712345678"]', 'spam\nqo‘ng‘iroq'], // #2 city number, control char in note
  ['123', '["123"]', null], // #3 too short
  ['900000001', '["900000001"]', 'dup'], // #4 same as #1 after normalising
];

class InMemoryBlacklistRepository implements BlacklistRepository {
  readonly rows: (BlockedNumberValues & { extension: string })[] = [];
  async existingNumbers(extension: string) {
    return new Set(this.rows.filter((r) => r.extension === extension).map((r) => r.number));
  }
  async insertIfAbsent(values: BlockedNumberValues, extension: string) {
    if (this.rows.some((r) => r.number === values.number && r.extension === extension)) return false;
    this.rows.push({ ...values, extension });
    return true;
  }
}

describe('blacklist mapper', () => {
  let dir: string;
  let legacy: LegacySources;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-migrate-blacklist-'));
    const file = path.join(dir, 'callcenter.db');
    const db = new DatabaseSync(file);
    db.exec(SCHEMA);
    const insert = db.prepare(
      `INSERT INTO blacklist (number, variants, note, created_at, updated_at) VALUES (?, ?, ?, '2026-10-01 07:00:00', '2026-10-01 07:00:00')`,
    );
    for (const [n, v, note] of ROWS) insert.run(n, v, note);
    db.close();
    legacy = openLegacySources({ sqlitePath: file });
  });
  afterAll(() => {
    legacy.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = (dryRun: boolean): MigrationContext => ({
    legacy,
    db: {} as Kysely<DB>,
    dryRun,
    logger: { info: () => undefined, warn: () => undefined },
  });
  const rows = () => legacy.sqlite!.all('SELECT rowid, * FROM blacklist ORDER BY rowid');

  it('normalises the number, recomputes the AstDB variants and reads UTC times', () => {
    const r = transformLegacyBlocked(rows()[0]);
    expect(r).toMatchObject({
      ok: true,
      values: { number: '900000001', variants: ['900000001', '998900000001'], note: 'Asterisk 114' },
    });
    expect(r.ok && r.values.createdAt?.toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(transformLegacyBlocked(rows()[1])).toMatchObject({ ok: true, values: { note: 'spam qo‘ng‘iroq' } });
    expect(transformLegacyBlocked(rows()[2])).toEqual({
      ok: false,
      key: '#3',
      reason: 'number is not usable (3 digits)',
    });
  });

  it('puts rows on the extension 114 list, once; a re-run changes nothing', async () => {
    const repo = new InMemoryBlacklistRepository();
    const dry = await createBlacklistMapper(() => repo).run(ctx(true));
    expect(MapperReportSchema.parse(dry)).toEqual(dry);
    expect(dry).toMatchObject({ status: 'ok', read: 4, inserted: 2 });
    expect(repo.rows).toHaveLength(0);

    const first = await createBlacklistMapper(() => repo).run(ctx(false));
    expect(first).toMatchObject({ inserted: 2, unchanged: 0 });
    expect(first.skipped).toEqual([
      { key: '#3', reason: 'number is not usable (3 digits)' },
      { key: '#4', reason: 'same number as legacy row #1 after normalising' },
    ]);
    expect(repo.rows.map((r) => r.extension)).toEqual(['114', '114']);

    const second = await createBlacklistMapper(() => repo).run(ctx(false));
    expect(second).toMatchObject({ inserted: 0, unchanged: 2 });
    expect(JSON.stringify(second)).not.toContain('900000001');
  });
});
