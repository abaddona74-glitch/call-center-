import { normalizeUzPhone } from '@cc/shared';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { InjectPbxDb, type PbxDb } from '../../pbx/pbx-db.module.js';
import type { PbxDB } from '../../pbx/pbx-db.types.js';
import type { CdrRecordingRow } from './domain/cdr-recording.js';

const COLUMNS = [
  'calldate',
  'uniqueid',
  'linkedid',
  'src',
  'dst',
  'cnum',
  'channel',
  'dstchannel',
  'recordingfile',
] as const;

/** Read-only CDR lookups for recordings (parameterized SELECTs only). */
@Injectable()
export class RecordingsRepository {
  constructor(@InjectPbxDb() private readonly pbx: PbxDb) {}

  private db(): Kysely<PbxDB> {
    if (!this.pbx) throw new ServiceUnavailableException('PBX unavailable');
    return this.pbx;
  }

  /** Every CDR row of the call: its own legs and the legs linked to it (queue members, transfers). */
  async rowsForCall(uniqueid: string): Promise<CdrRecordingRow[]> {
    const rows = await this.db()
      .selectFrom('cdr')
      .select(COLUMNS)
      .where((eb) => eb.or([eb('uniqueid', '=', uniqueid), eb('linkedid', '=', uniqueid)]))
      .orderBy('calldate')
      .limit(100)
      .execute();
    return rows.map(toRow);
  }

  /**
   * Answered calls with a recording in [from, to] (PBX local dates), one row per uniqueid.
   * `search` is an exact operator extension or an exact client number (after normalizeUzPhone).
   * Returns at most `limit` rows; callers pass limit+1 to detect "too many".
   */
  async recordedCallsInRange(from: string, to: string, search: string | undefined, limit: number): Promise<CdrRecordingRow[]> {
    let q = this.db()
      .selectFrom('cdr')
      .select([
        'uniqueid',
        sql<string>`MIN(calldate)`.as('calldate'),
        sql<string>`MAX(linkedid)`.as('linkedid'),
        sql<string>`MAX(src)`.as('src'),
        sql<string>`MAX(dst)`.as('dst'),
        sql<string>`MAX(cnum)`.as('cnum'),
        sql<string>`MAX(channel)`.as('channel'),
        sql<string>`MAX(dstchannel)`.as('dstchannel'),
        sql<string>`MAX(recordingfile)`.as('recordingfile'),
      ])
      .where('calldate', '>=', `${from} 00:00:00`)
      .where('calldate', '<=', `${to} 23:59:59`)
      .where('disposition', '=', 'ANSWERED')
      .where('billsec', '>', 0)
      .where('recordingfile', '<>', '');

    const term = search?.trim();
    if (term) {
      if (/^\d{2,6}$/.test(term)) {
        q = q.where((eb) =>
          eb.or([
            eb('src', '=', term),
            eb('dst', '=', term),
            eb('channel', 'like', `SIP/${term}-%`),
            eb('channel', 'like', `PJSIP/${term}-%`),
            eb('dstchannel', 'like', `SIP/${term}-%`),
            eb('dstchannel', 'like', `PJSIP/${term}-%`),
            eb('dstchannel', 'like', `Local/${term}@%`),
          ]),
        );
      } else {
        const phone = normalizeUzPhone(term);
        if (!phone) return [];
        const variants = phone.length === 9 ? [phone, `998${phone}`, `+998${phone}`, `8${phone}`, `0${phone}`] : [phone];
        q = q.where((eb) => eb.or([eb('src', 'in', variants), eb('dst', 'in', variants)]));
      }
    }

    const rows = await q.groupBy('uniqueid').orderBy(sql`MIN(calldate)`).limit(limit).execute();
    return rows.map(toRow);
  }
}

function toRow(r: Partial<Record<(typeof COLUMNS)[number], unknown>>): CdrRecordingRow {
  return {
    calldate: String(r.calldate ?? ''),
    uniqueid: String(r.uniqueid ?? ''),
    linkedid: String(r.linkedid ?? ''),
    src: String(r.src ?? ''),
    dst: String(r.dst ?? ''),
    cnum: String(r.cnum ?? ''),
    channel: String(r.channel ?? ''),
    dstchannel: String(r.dstchannel ?? ''),
    recordingfile: String(r.recordingfile ?? ''),
  };
}
