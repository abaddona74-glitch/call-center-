import type { Passkey } from '@cc/shared';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { type DbHost, InjectDb } from '../../database/db.js';

export interface PasskeyRow {
  id: string;
  userId: number;
  publicKey: Buffer;
  counter: number;
  deviceType: string | null;
  backedUp: boolean;
  transports: string[] | null;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

@Injectable()
export class PasskeysRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  private select() {
    return this.txHost.tx
      .selectFrom('passkeys')
      .select([
        'id',
        'userId',
        'publicKey',
        'counter',
        'deviceType',
        'backedUp',
        'transports',
        'name',
        'createdAt',
        'lastUsedAt',
      ]);
  }

  listByUser(userId: number): Promise<PasskeyRow[]> {
    return this.select().where('userId', '=', userId).orderBy('createdAt').execute();
  }

  findById(id: string): Promise<PasskeyRow | undefined> {
    return this.select().where('id', '=', id).executeTakeFirst();
  }

  async countByUser(userId: number): Promise<number> {
    const row = await this.txHost.tx
      .selectFrom('passkeys')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('userId', '=', userId)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async insert(row: {
    id: string;
    userId: number;
    publicKey: Buffer;
    counter: number;
    deviceType: string | null;
    backedUp: boolean;
    transports: string[] | null;
    name: string;
  }): Promise<void> {
    await this.txHost.tx.insertInto('passkeys').values(row).execute();
  }

  async rename(id: string, name: string): Promise<void> {
    await this.txHost.tx.updateTable('passkeys').set({ name }).where('id', '=', id).execute();
  }

  async touch(id: string, counter: number): Promise<void> {
    await this.txHost.tx
      .updateTable('passkeys')
      .set({ counter, lastUsedAt: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  /** Deletes the passkey; returns ids of the sessions that were opened with it (deleted by FK). */
  async delete(id: string): Promise<string[]> {
    const sessions = await this.txHost.tx.selectFrom('sessions').select('id').where('passkeyId', '=', id).execute();
    await this.txHost.tx.deleteFrom('passkeys').where('id', '=', id).execute();
    return sessions.map((s) => s.id);
  }
}

export function toPasskeyDto(row: PasskeyRow): Passkey {
  return {
    id: row.id,
    name: row.name,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}
