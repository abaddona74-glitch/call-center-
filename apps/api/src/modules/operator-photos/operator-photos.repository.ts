import { Injectable } from '@nestjs/common';
import { type DbHost, InjectDb } from '../../database/db.js';
import { InjectPbxDb, type PbxDb } from '../../pbx/pbx-db.module.js';
import './operator-photos.tables.js';

export interface OperatorPhotoRow {
  extension: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  updatedAt: Date;
}

const COLUMNS = ['extension', 'storageKey', 'mimeType', 'sizeBytes', 'updatedAt'] as const;

@Injectable()
export class OperatorPhotosRepository {
  constructor(
    @InjectDb() private readonly txHost: DbHost,
    @InjectPbxDb() private readonly pbx: PbxDb,
  ) {}

  list(): Promise<OperatorPhotoRow[]> {
    return this.txHost.tx.selectFrom('operatorPhotos').select(COLUMNS).execute();
  }

  find(extension: string): Promise<OperatorPhotoRow | undefined> {
    return this.txHost.tx
      .selectFrom('operatorPhotos')
      .select(COLUMNS)
      .where('extension', '=', extension)
      .executeTakeFirst();
  }

  /** Sets the extension's photo (insert or replace). */
  async upsert(
    row: { extension: string; storageKey: string; mimeType: string; sizeBytes: number },
    userId: number,
  ): Promise<void> {
    const updatedAt = new Date();
    await this.txHost.tx
      .insertInto('operatorPhotos')
      .values({ ...row, updatedAt, updatedByUserId: userId })
      .onConflict((oc) =>
        oc.column('extension').doUpdateSet({
          storageKey: row.storageKey,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          updatedAt,
          updatedByUserId: userId,
        }),
      )
      .execute();
  }

  async delete(extension: string): Promise<void> {
    await this.txHost.tx.deleteFrom('operatorPhotos').where('extension', '=', extension).execute();
  }

  /** Extensions and names from `asterisk.users`; null when the PBX database is not configured. */
  async pbxDirectory(): Promise<Array<{ extension: string; name: string | null }> | null> {
    if (!this.pbx) return null;
    const rows = await this.pbx.selectFrom('asterisk.users').select(['extension', 'name']).execute();
    return rows.map((r) => ({ extension: String(r.extension ?? ''), name: r.name ?? null }));
  }
}
