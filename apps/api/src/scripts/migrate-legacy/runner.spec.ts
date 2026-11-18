import type { Kysely } from 'kysely';
import type { DB } from '../../database/db.js';
import type { JsonSource, LegacySources } from './legacy-sources.js';
import { emptyReport, type Mapper, type MapperReport, MapperReportSchema } from './mapper.js';
import { ALL_MAPPERS } from './mappers/index.js';
import { countArray, notImplementedMapper, notMigratedMapper } from './mappers/not-implemented.js';
import { formatReport } from './report.js';
import { type BeginUnitOfWork, exitCodeFor, runMappers, selectMappers } from './runner.js';

function fakeLegacy(opts: { tables?: Record<string, number>; json?: Record<string, unknown> } = {}): LegacySources {
  const tables = opts.tables ?? {};
  return {
    sqlite: {
      hasTable: (t: string) => t in tables,
      count: (t: string) => tables[t],
    } as unknown as LegacySources['sqlite'],
    dataDir: '/legacy-json',
    readJson: (file: string): JsonSource =>
      opts.json && file in opts.json
        ? { status: 'ok', path: `/legacy-json/${file}`, data: opts.json[file] }
        : { status: 'missing', path: `/legacy-json/${file}` },
    close: () => {},
  };
}

function fakeBegin() {
  const calls: string[] = [];
  const db = {} as Kysely<DB>;
  const begin: BeginUnitOfWork = async ({ readOnly }) => {
    calls.push(readOnly ? 'begin ro' : 'begin rw');
    return {
      db,
      commit: async () => void calls.push('commit'),
      rollback: async () => void calls.push('rollback'),
    };
  };
  return { begin, calls, db };
}

function mapperReturning(name: string, patch: Partial<MapperReport>, seen?: boolean[]): Mapper {
  const meta = { name, owner: 'S6' };
  return {
    ...meta,
    run: async (ctx) => {
      seen?.push(ctx.dryRun);
      return { ...emptyReport(meta), ...patch };
    },
  };
}

const logger = { info: vi.fn(), warn: vi.fn() };

describe('runMappers', () => {
  it('dry-run: read-only transactions, always rolled back, never audited', async () => {
    const { begin, calls } = fakeBegin();
    const audit = vi.fn();
    const seen: boolean[] = [];
    const reports = await runMappers([mapperReturning('a', { read: 3, inserted: 3 }, seen)], {
      legacy: fakeLegacy(),
      begin,
      dryRun: true,
      logger,
      audit,
    });
    expect(calls).toEqual(['begin ro', 'rollback']);
    expect(seen).toEqual([true]);
    expect(audit).not.toHaveBeenCalled();
    expect(reports[0]).toMatchObject({ status: 'ok', inserted: 3 });
    expect(exitCodeFor(reports)).toBe(0);
  });

  it('real run: commits, audits only mappers that changed rows', async () => {
    const { begin, calls, db } = fakeBegin();
    const audit = vi.fn(async () => {});
    const reports = await runMappers(
      [mapperReturning('changed', { read: 2, inserted: 2 }), mapperReturning('same', { read: 2, unchanged: 2 })],
      { legacy: fakeLegacy(), begin, dryRun: false, logger, audit },
    );
    expect(calls).toEqual(['begin rw', 'commit', 'begin rw', 'commit']);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(db, reports[0]);
    expect(exitCodeFor(reports)).toBe(0);
  });

  it('rolls back a mapper that throws or reports errors, keeps running the rest, exits non-zero', async () => {
    const { begin, calls } = fakeBegin();
    const throwing: Mapper = {
      name: 'boom',
      owner: 'S6',
      run: async () => {
        throw new Error('connection reset');
      },
    };
    const reports = await runMappers(
      [throwing, mapperReturning('bad-row', { errors: [{ key: '#1', reason: 'x' }] }), mapperReturning('ok', {})],
      { legacy: fakeLegacy(), begin, dryRun: false, logger },
    );
    expect(calls).toEqual(['begin rw', 'rollback', 'begin rw', 'rollback', 'begin rw', 'commit']);
    expect(reports.map((r) => r.status)).toEqual(['failed', 'failed', 'ok']);
    expect(reports[0].errors).toEqual([{ key: 'boom', reason: 'connection reset' }]);
    expect(reports[0].notes).toContain('transaction rolled back — nothing from this mapper was written');
    expect(exitCodeFor(reports)).toBe(1);
  });
});

describe('selectMappers', () => {
  it('keeps the run order regardless of the --only order', () => {
    const names = selectMappers(ALL_MAPPERS, ['tickets', 'users']).map((m) => m.name);
    expect(names).toEqual(['users', 'tickets']);
    expect(selectMappers(ALL_MAPPERS)).toHaveLength(ALL_MAPPERS.length);
  });

  it('every mapper has a unique kebab-case name and an owner', () => {
    const names = ALL_MAPPERS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    for (const m of ALL_MAPPERS) {
      expect(m.name).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(m.owner).not.toBe('');
    }
  });
});

describe('not-implemented mappers', () => {
  it('count waiting legacy rows and report missing sources without failing', async () => {
    const stub = notImplementedMapper(
      { name: 'stub', owner: 'S4' },
      {
        sqliteTables: ['pending_callbacks', 'absent_table'],
        jsonFiles: [
          { file: 'tickets.json', count: countArray('tickets') },
          { file: 'missing.json', count: countArray() },
        ],
      },
    );
    const report = await stub.run({
      legacy: fakeLegacy({ tables: { pending_callbacks: 4 }, json: { 'tickets.json': { tickets: [{}, {}] } } }),
      db: {} as Kysely<DB>,
      dryRun: true,
      logger,
    });
    expect(MapperReportSchema.parse(report)).toEqual(report);
    expect(report).toMatchObject({ status: 'not-implemented', read: 6, inserted: 0, errors: [] });
    expect(report.notes).toEqual([
      'not implemented — owned by S4; nothing is migrated',
      'pending_callbacks: 4 rows waiting',
      'absent_table: legacy table not found',
      'tickets.json: 2 records waiting',
      'missing.json: not found in --data-dir',
    ]);
    expect(exitCodeFor([report])).toBe(0);
  });

  it('a not-migrated mapper says why, counts what is left in legacy and is not a failure', async () => {
    const dropped = notMigratedMapper(
      { name: 'dropped', owner: 'stage 2' },
      { sqliteTables: ['pending_callbacks'], jsonFiles: [{ file: 'tickets.json', count: countArray('tickets') }] },
      'owner decision — dropped',
    );
    const report = await dropped.run({
      legacy: fakeLegacy({ tables: { pending_callbacks: 3 }, json: { 'tickets.json': { tickets: [{}] } } }),
      db: {} as Kysely<DB>,
      dryRun: false,
      logger,
    });
    expect(report).toMatchObject({ status: 'not-migrated', read: 4, inserted: 0, errors: [] });
    expect(report.notes).toEqual([
      'not migrated: owner decision — dropped',
      'pending_callbacks: 3 rows left in legacy',
      'tickets.json: 1 records left in legacy',
    ]);
    expect(exitCodeFor([report])).toBe(0);
    const text = formatReport([report], { dryRun: false });
    expect(text).toContain('dropped [owner stage 2] not migrated (owner decision)');
    expect(text).toContain('read 4 (not migrated)');
    expect(text).toContain('Summary: 0 ok, 1 not migrated by decision');
  });
});

describe('formatReport', () => {
  it('labels dry-run counts as "would" and lists issues and notes', () => {
    const report: MapperReport = {
      ...emptyReport({ name: 'users', owner: 'S1' }),
      read: 3,
      inserted: 1,
      unchanged: 1,
      skipped: [{ key: '#2 x', reason: 'unknown role "manager"' }],
      notes: ['a note'],
    };
    const text = formatReport([report, emptyReport({ name: 'tickets', owner: 'S5' }, 'not-implemented')], {
      dryRun: true,
    });
    expect(text).toContain('DRY RUN');
    expect(text).toContain('users [owner S1] ok');
    expect(text).toContain(
      'read 3 | would insert 1 | would update 0 | unchanged 1 | skipped 1 | warnings 0 | errors 0',
    );
    expect(text).toContain('skipped  #2 x: unknown role "manager"');
    expect(text).toContain('note     a note');
    expect(text).toContain('tickets [owner S5] NOT IMPLEMENTED');
    expect(text).toContain('Summary: 1 ok, 0 not migrated by decision, 1 not implemented, 0 source missing, 0 failed');
    expect(formatReport([report], { dryRun: false })).toContain('read 3 | insert 1 |');
  });
});
