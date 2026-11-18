import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { type DbHost, InjectDb } from '../../database/db.js';
import { InjectPbxDb, type PbxDb } from '../../pbx/pbx-db.module.js';
import './excluded-operators.tables.js';

export interface ExcludedOperatorsRow {
  extensions: string[];
  updatedAt: Date;
}

@Injectable()
export class ExcludedOperatorsRepository {
  constructor(
    @InjectDb() private readonly txHost: DbHost,
    @InjectPbxDb() private readonly pbx: PbxDb,
  ) {}

  async read(): Promise<ExcludedOperatorsRow> {
    const row = await this.txHost.tx
      .selectFrom('excludedOperators')
      .select(['extensions', 'updatedAt'])
      .where('id', '=', 1)
      .executeTakeFirst();
    if (!row) throw new Error('excluded_operators is empty: run the database migrations');
    return { extensions: [...row.extensions], updatedAt: row.updatedAt };
  }

  async write(extensions: string[], userId: number): Promise<void> {
    await this.txHost.tx
      .updateTable('excludedOperators')
      .set({
        extensions: sql<string[]>`${sql.val(extensions)}::text[]`,
        updatedAt: sql<Date>`now()`,
        updatedByUserId: userId,
      })
      .where('id', '=', 1)
      .execute();
  }

  /** Extensions and names from `asterisk.users`; null when the PBX database is not configured. */
  async pbxDirectory(): Promise<Array<{ extension: string; name: string | null }> | null> {
    if (!this.pbx) return null;
    const rows = await this.pbx.selectFrom('asterisk.users').select(['extension', 'name']).execute();
    return rows.map((r) => ({ extension: String(r.extension ?? ''), name: r.name ?? null }));
  }
}
