import { DummyDriver, Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { AppConfig } from '../config/app-config.js';
import type { DbHost } from '../database/db.js';
import { CallbacksReconciler, CdrLegsReader } from '../modules/callbacks/callbacks.reconciler.js';
import type { CallbacksService } from '../modules/callbacks/callbacks.service.js';
import { ContactsRepository } from '../modules/contacts/contacts.repository.js';
import { RecordingsRepository } from '../modules/recordings/recordings.repository.js';
import type { PbxDB } from './pbx-db.types.js';

/**
 * The production Issabel PBX (18.11.2026) has no `cdr.linkedid` column. With PBX_CDR_HAS_LINKEDID=false no
 * query against the PBX may name it (MariaDB: "Unknown column 'linkedid'"); with true they keep using it.
 * Queries run against a compile-only MySQL Kysely that records the SQL.
 */
function pbx(): { db: Kysely<PbxDB>; sql: string[]; params: unknown[][] } {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const db = new Kysely<PbxDB>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (k) => new MysqlIntrospector(k),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    },
    log: (event) => {
      sql.push(event.query.sql);
      params.push([...event.query.parameters]);
    },
  });
  return { db, sql, params };
}

const config = (hasLinkedid: boolean) =>
  ({ get: (key: string) => (key === 'PBX_CDR_HAS_LINKEDID' ? hasLinkedid : undefined) }) as unknown as AppConfig;

/** The callbacks reconciliation as the controller runs it: a manual 24 h sync, read slice by slice. */
async function reconcile24h(db: Kysely<PbxDB>, hasLinkedid: boolean): Promise<void> {
  const callbacks = {
    calendar: () => ({}),
    settings: async () => ({ minTalkSeconds: 20 }),
    legacyImportedUntil: async () => null,
    publish: async () => undefined,
  } as unknown as CallbacksService;
  const reconciler = new CallbacksReconciler(
    new CdrLegsReader(db, config(hasLinkedid)),
    callbacks,
    config(hasLinkedid),
    {} as SchedulerRegistry,
  );
  await reconciler.sync(24, new Date('2026-11-18T19:00:00+05:00'));
}

/** 24 h + 1 h guard before the window + 1 min clock skew after it, in 1 h slices. */
const SLICES_24H = 26;

async function queriesOf(hasLinkedid: boolean): Promise<string[]> {
  const { db, sql } = pbx();
  await reconcile24h(db, hasLinkedid);
  await new ContactsRepository({} as DbHost, db, config(hasLinkedid)).callerAggregates(
    '2026-11-18 00:00:00',
    '2026-11-19 00:00:00',
  );
  const rec = new RecordingsRepository(db, config(hasLinkedid));
  await rec.rowsForCall('1795005384.2633931');
  await rec.recordedCallsInRange('2026-11-18', '2026-11-18', undefined, 10);
  return sql;
}

describe('PBX CDR queries and cdr.linkedid', () => {
  it('never name linkedid when the PBX has no such column (PBX_CDR_HAS_LINKEDID=false)', async () => {
    const sql = await queriesOf(false);
    expect(sql).toHaveLength(SLICES_24H + 3);
    // Only the result alias ("uniqueid as `linkedid`") may carry the name.
    for (const q of sql) expect(q.replace(/as `linkedid`/gi, '')).not.toMatch(/linkedid/i);
  });

  it('keep grouping by linkedid when the column exists (default)', async () => {
    const sql = await queriesOf(true);
    expect(sql).toHaveLength(SLICES_24H + 3);
    for (const q of sql) expect(q.replace(/as `linkedid`/gi, '')).toMatch(/linkedid/i);
  });
});

describe('CDR reader of the callbacks reconciliation', () => {
  const MEMBER_ATTEMPTS = 'not (`channel` like ? and `dcontext` = ? and `dstchannel` = ?)';

  it('reads the window in consecutive hourly slices, each with a row cap', async () => {
    const { db, sql, params } = pbx();
    await reconcile24h(db, false);
    expect(sql).toHaveLength(SLICES_24H);
    for (const q of sql) expect(q).toMatch(/where `calldate` >= \? and `calldate` < \? and .* limit \?$/);
    const bounds = params.map((p) => [p[0], p[1]]);
    expect(bounds[0][0]).toBe('2026-11-17 18:00:00'); // 24 h + 1 h guard before 19:00
    expect(bounds.at(-1)?.[1]).toBe('2026-11-18 19:01:00');
    for (let i = 1; i < bounds.length; i++) expect(bounds[i][0]).toBe(bounds[i - 1][1]); // no gaps, no overlaps
    for (const p of params) expect(p.at(-1)).toBe(50_001); // cap + 1: a full slice is detectable
  });

  it("leaves out queue members' own ring attempts only when legs are keyed by uniqueid (no linkedid)", async () => {
    const off = pbx();
    await new CdrLegsReader(off.db, config(false)).read('2026-11-18 10:00:00', '2026-11-18 11:00:00', 100);
    expect(off.sql[0]).toContain(MEMBER_ATTEMPTS);
    expect(off.params[0]).toEqual(['2026-11-18 10:00:00', '2026-11-18 11:00:00', 'Local/%', 'from-internal', '', 100]);

    const on = pbx();
    await new CdrLegsReader(on.db, config(true)).read('2026-11-18 10:00:00', '2026-11-18 11:00:00', 100);
    expect(on.sql[0]).not.toMatch(/`channel` like|`dstchannel` =/);
    expect(on.params[0]).toEqual(['2026-11-18 10:00:00', '2026-11-18 11:00:00', 100]);
  });
});
