import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { AppConfig } from '../../config/app-config.js';
import { InjectPbxDb, type PbxDb } from '../pbx-db.module.js';
import type { PbxDB } from '../pbx-db.types.js';
import type { CdrRow } from './cdr-row.js';

/** Hard cap per query so one bad request can never pull the whole CDR table into memory. */
const MAX_ROWS = 200_000;

/**
 * Read-only, parameterized queries against asteriskcdrdb.cdr / asterisk.users (no string-built SQL).
 * Every failure becomes 503 "PBX unavailable" — the PBX being down must not look like a bug in our API.
 */
@Injectable()
export class CdrRepository {
  private readonly logger = new Logger(CdrRepository.name);
  private readonly hasLinkedid: boolean;

  constructor(
    @InjectPbxDb() private readonly pbx: PbxDb,
    config: AppConfig,
  ) {
    this.hasLinkedid = config.get('PBX_CDR_HAS_LINKEDID');
  }

  get enabled(): boolean {
    return this.pbx !== null;
  }

  private db(): Kysely<PbxDB> {
    if (!this.pbx) throw new ServiceUnavailableException('PBX database is not configured');
    return this.pbx;
  }

  private async run<T>(what: string, fn: (db: Kysely<PbxDB>) => Promise<T>): Promise<T> {
    const db = this.db();
    try {
      return await fn(db);
    } catch (err) {
      this.logger.error(`PBX query "${what}" failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new ServiceUnavailableException('PBX database unavailable');
    }
  }

  private selectRows(db: Kysely<PbxDB>) {
    return db
      .selectFrom('cdr')
      .select([
        'calldate',
        'clid',
        'src',
        'dst',
        'dcontext',
        'channel',
        'dstchannel',
        'lastapp',
        'lastdata',
        'duration',
        'billsec',
        'disposition',
        'uniqueid',
        'recordingfile',
      ])
      .select(this.hasLinkedid ? sql<string>`linkedid`.as('linkedid') : sql<string>`uniqueid`.as('linkedid'));
  }

  /** Rows with `fromWall <= calldate < toWall` (Tashkent wall-clock strings; sargable on the calldate index). */
  async rowsBetween(fromWall: string, toWall: string): Promise<CdrRow[]> {
    const rows = await this.run('rowsBetween', (db) =>
      this.selectRows(db).where('calldate', '>=', fromWall).where('calldate', '<', toWall).limit(MAX_ROWS).execute(),
    );
    if (rows.length >= MAX_ROWS) this.logger.warn(`rowsBetween(${fromWall}, ${toWall}) hit the ${MAX_ROWS} row cap`);
    return rows.map(toCdrRow);
  }

  /** Rows of one call inside a time window. */
  async callRows(id: string, fromWall: string, toWall: string): Promise<CdrRow[]> {
    const rows = await this.run('callRows', (db) =>
      this.selectRows(db)
        .where('calldate', '>=', fromWall)
        .where('calldate', '<', toWall)
        .where((eb) =>
          this.hasLinkedid ? eb.or([eb('linkedid', '=', id), eb('uniqueid', '=', id)]) : eb('uniqueid', '=', id),
        )
        .orderBy('calldate')
        .limit(500)
        .execute(),
    );
    return rows.map(toCdrRow);
  }

  /** calldate of a leg by uniqueid (indexed), to locate a call whose id is not epoch-based. */
  async calldateOf(uniqueid: string): Promise<string | null> {
    const row = await this.run('calldateOf', (db) =>
      db.selectFrom('cdr').select('calldate').where('uniqueid', '=', uniqueid).limit(1).executeTakeFirst(),
    );
    return row?.calldate ?? null;
  }

  /** Most recent days (YYYY-MM-DD) on which any of `numbers` appears as src or dst (src/dst are indexed). */
  async daysWithNumbers(numbers: string[], limit: number): Promise<string[]> {
    if (numbers.length === 0) return [];
    const rows = await this.run('daysWithNumbers', (db) =>
      db
        .selectFrom('cdr')
        .select(sql<string>`DATE(calldate)`.as('day'))
        .where((eb) => eb.or([eb('src', 'in', numbers), eb('dst', 'in', numbers)]))
        .groupBy(sql`DATE(calldate)`)
        .orderBy(sql`DATE(calldate)`, 'desc')
        .limit(limit)
        .execute(),
    );
    return rows.map((r) => String(r.day).slice(0, 10));
  }

  /** asterisk.users: extension → display name. */
  async operatorNames(): Promise<{ extension: string; name: string | null }[]> {
    return this.run('operatorNames', (db) => db.selectFrom('asterisk.users').select(['extension', 'name']).execute());
  }
}

function toCdrRow(r: Record<string, unknown>): CdrRow {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    calldate: s(r.calldate),
    clid: s(r.clid),
    src: s(r.src),
    dst: s(r.dst),
    dcontext: s(r.dcontext),
    channel: s(r.channel),
    dstchannel: s(r.dstchannel),
    lastapp: s(r.lastapp),
    lastdata: s(r.lastdata),
    duration: n(r.duration),
    billsec: n(r.billsec),
    disposition: s(r.disposition),
    uniqueid: s(r.uniqueid),
    linkedid: s(r.linkedid),
    recordingfile: s(r.recordingfile),
  };
}
