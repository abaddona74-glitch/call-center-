import { Injectable } from '@nestjs/common';
import { InjectPbxDb, type PbxDb } from '../../pbx/pbx-db.module.js';

/** Read-only PBX lookups for the live board. */
@Injectable()
export class LiveRepository {
  constructor(@InjectPbxDb() private readonly pbx: PbxDb) {}

  /** Extensions and display names from `asterisk.users`; null when the PBX DB is not configured. */
  async operatorDirectory(): Promise<Array<{ extension: string; name: string }> | null> {
    if (!this.pbx) return null;
    const rows = await this.pbx.selectFrom('asterisk.users').select(['extension', 'name']).execute();
    return rows
      .filter((r) => /^[0-9]{2,6}$/.test(r.extension))
      .map((r) => ({ extension: r.extension, name: (r.name ?? '').trim() || `Operator ${r.extension}` }));
  }
}
