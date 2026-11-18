import { DummyDriver, Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/app-config.js';
import type { DbHost } from '../database/db.js';
import { CdrLegsReader } from '../modules/callbacks/callbacks.reconciler.js';
import { ContactsRepository } from '../modules/contacts/contacts.repository.js';
import { RecordingsRepository } from '../modules/recordings/recordings.repository.js';
import type { PbxDB } from './pbx-db.types.js';

/**
 * The production Issabel PBX (18.11.2026) has no `cdr.linkedid` column. With PBX_CDR_HAS_LINKEDID=false no
 * query against the PBX may name it (MariaDB: "Unknown column 'linkedid'"); with true they keep using it.
 * Queries run against a compile-only MySQL Kysely that records the SQL.
 */
function pbx(): { db: Kysely<PbxDB>; sql: string[] } {
  const sql: string[] = [];
  const db = new Kysely<PbxDB>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (k) => new MysqlIntrospector(k),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    },
    log: (event) => {
      sql.push(event.query.sql);
    },
  });
  return { db, sql };
}

const config = (hasLinkedid: boolean) =>
  ({ get: (key: string) => (key === 'PBX_CDR_HAS_LINKEDID' ? hasLinkedid : undefined) }) as unknown as AppConfig;

async function queriesOf(hasLinkedid: boolean): Promise<string[]> {
  const { db, sql } = pbx();
  await new CdrLegsReader(db, config(hasLinkedid)).read('2026-11-18 00:00:00', '2026-11-19 00:00:00');
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
    expect(sql).toHaveLength(4);
    // Only the result alias ("uniqueid as `linkedid`") may carry the name.
    for (const q of sql) expect(q.replace(/as `linkedid`/gi, '')).not.toMatch(/linkedid/i);
  });

  it('keep grouping by linkedid when the column exists (default)', async () => {
    const sql = await queriesOf(true);
    expect(sql).toHaveLength(4);
    for (const q of sql) expect(q.replace(/as `linkedid`/gi, '')).toMatch(/linkedid/i);
  });
});
