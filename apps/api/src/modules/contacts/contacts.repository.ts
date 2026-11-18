import type { Contact, ContactInputParsed, ContactListQuery } from '@cc/shared';
import { Injectable } from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import { AppConfig } from '../../config/app-config.js';
import { type DbHost, InjectDb } from '../../database/db.js';
import { InjectPbxDb, type PbxDb } from '../../pbx/pbx-db.module.js';
import type { ContactsTable } from './contacts.tables.js';
import type { CallerAggregateRow } from './domain/top-callers.js';

const COLUMNS = ['phone', 'name', 'organization', 'language', 'note', 'telegram', 'createdAt', 'updatedAt'] as const;

function toDto(r: Pick<Selectable<ContactsTable>, (typeof COLUMNS)[number]>): Contact {
  return { ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}

function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

@Injectable()
export class ContactsRepository {
  private readonly hasLinkedid: boolean;

  constructor(
    @InjectDb() private readonly txHost: DbHost,
    @InjectPbxDb() private readonly pbx: PbxDb,
    config: AppConfig,
  ) {
    this.hasLinkedid = config.get('PBX_CDR_HAS_LINKEDID');
  }

  async list(q: ContactListQuery): Promise<{ items: Contact[]; total: number }> {
    let base = this.txHost.tx.selectFrom('contacts');
    if (q.language === 'none') base = base.where('language', 'is', null);
    else if (q.language) base = base.where('language', '=', q.language);
    if (q.q) {
      const like = `%${escapeLike(q.q.toLowerCase())}%`;
      const digits = q.q.replace(/\D/g, '');
      base = base.where((eb) =>
        eb.or([
          eb(sql`lower(name)`, 'like', like),
          eb(sql`lower(organization)`, 'like', like),
          eb(sql`lower(note)`, 'like', like),
          eb(sql`lower(coalesce(telegram, ''))`, 'like', like),
          ...(digits.length >= 3
            ? [
                eb('phone', 'like', `%${escapeLike(digits)}%`),
                eb(sql`'998' || phone`, 'like', `%${escapeLike(digits)}%`),
              ]
            : []),
        ]),
      );
    }
    const { total } = await base.select(sql<number>`count(*)::int`.as('total')).executeTakeFirstOrThrow();
    const rows = await base
      .select([...COLUMNS])
      .orderBy('updatedAt', 'desc')
      .orderBy('phone')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { items: rows.map(toDto), total };
  }

  async get(phone: string): Promise<Contact | null> {
    const row = await this.txHost.tx
      .selectFrom('contacts')
      .select([...COLUMNS])
      .where('phone', '=', phone)
      .executeTakeFirst();
    return row ? toDto(row) : null;
  }

  async getMany(phones: readonly string[]): Promise<Map<string, Contact>> {
    if (phones.length === 0) return new Map();
    const rows = await this.txHost.tx
      .selectFrom('contacts')
      .select([...COLUMNS])
      .where('phone', 'in', [...phones])
      .execute();
    return new Map(rows.map((r) => [r.phone, toDto(r)]));
  }

  async upsert(c: ContactInputParsed, userId: number): Promise<Contact> {
    const row = await this.txHost.tx
      .insertInto('contacts')
      .values({
        phone: c.phone,
        name: c.name,
        organization: c.organization,
        language: c.language,
        note: c.note,
        telegram: c.telegram,
        createdByUserId: userId,
        updatedByUserId: userId,
      })
      .onConflict((oc) =>
        oc.column('phone').doUpdateSet({
          name: c.name,
          organization: c.organization,
          language: c.language,
          note: c.note,
          telegram: c.telegram,
          updatedByUserId: userId,
          updatedAt: sql<Date>`now()`,
        }),
      )
      .returning([...COLUMNS])
      .executeTakeFirstOrThrow();
    return toDto(row);
  }

  async delete(phone: string): Promise<boolean> {
    const res = await this.txHost.tx.deleteFrom('contacts').where('phone', '=', phone).executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  }

  get pbxAvailable(): boolean {
    return this.pbx !== null;
  }

  /**
   * Per raw caller id in a PBX wall-clock window: calls (by linkedid), calls answered by an operator,
   * operator talk time (no SUM(DISTINCT) — legacy B14) and the last call.
   */
  async callerAggregates(from: string, to: string): Promise<CallerAggregateRow[]> {
    if (!this.pbx) return [];
    const operatorAnswered = sql`(disposition = 'ANSWERED' AND billsec > 0
      AND (dstchannel LIKE 'Local/%' OR dstchannel REGEXP '^(SIP|PJSIP)/[0-9]{2,6}-'))`;
    // Without cdr.linkedid (PBX_CDR_HAS_LINKEDID=false) a call is keyed by uniqueid.
    const callKey = this.hasLinkedid ? sql`IF(linkedid <> '', linkedid, uniqueid)` : sql`uniqueid`;
    const res = await sql<{
      src: string;
      calls: number | string;
      answered: number | string;
      talk: number | string;
      last: string;
    }>`
      SELECT src,
             COUNT(DISTINCT ${callKey}) AS calls,
             COUNT(DISTINCT CASE WHEN ${operatorAnswered} THEN ${callKey} END) AS answered,
             COALESCE(SUM(CASE WHEN ${operatorAnswered} THEN billsec ELSE 0 END), 0) AS talk,
             MAX(calldate) AS last
        FROM cdr
       WHERE calldate >= ${from} AND calldate < ${to}
         AND dcontext <> 'from-internal'
         AND src REGEXP '^[+]?[0-9]{7,15}$'
       GROUP BY src
       ORDER BY calls DESC
       LIMIT 500`.execute(this.pbx);
    return res.rows.map((r) => ({
      src: r.src,
      calls: Number(r.calls),
      answered: Number(r.answered),
      talkSeconds: Number(r.talk),
      lastCall: r.last,
    }));
  }
}
