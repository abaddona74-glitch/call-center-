import type { Role, UserListQuery } from '@cc/shared';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { type DbHost, InjectDb } from '../../database/db.js';

export interface UserRow {
  id: number;
  username: string;
  role: Role;
  extension: string | null;
  email: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  passkeyCount: number;
  activeSessions: number;
}

export interface UserPatch {
  username?: string;
  role?: Role;
  extension?: string | null;
  email?: string | null;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

@Injectable()
export class UsersRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  private baseQuery() {
    return this.txHost.tx.selectFrom('users as u').select((eb) => [
      'u.id',
      'u.username',
      'u.role',
      'u.extension',
      'u.email',
      'u.isActive',
      'u.mustChangePassword',
      'u.createdAt',
      'u.updatedAt',
      'u.lastLoginAt',
      eb
        .selectFrom('passkeys as p')
        .select((e) => e.fn.countAll<number>().as('n'))
        .whereRef('p.userId', '=', 'u.id')
        .as('passkeyCount'),
      eb
        .selectFrom('sessions as s')
        .select((e) => e.fn.countAll<number>().as('n'))
        .whereRef('s.userId', '=', 'u.id')
        .where('s.expiresAt', '>', sql<Date>`now()`)
        .as('activeSessions'),
    ]);
  }

  async list(query: UserListQuery): Promise<UserRow[]> {
    let q = this.baseQuery();
    if (query.search) {
      const like = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      q = q.where((eb) =>
        eb.or([eb('u.username', 'ilike', like), eb('u.email', 'ilike', like), eb('u.extension', 'ilike', like)]),
      );
    }
    if (query.role) q = q.where('u.role', '=', query.role);
    if (query.active !== undefined) q = q.where('u.isActive', '=', query.active);
    const rows = await q
      .orderBy('u.role', 'desc')
      .orderBy(sql`lower(u.username)`)
      .execute();
    return rows.map(normalizeCounts);
  }

  async findById(id: number): Promise<UserRow | undefined> {
    const row = await this.baseQuery().where('u.id', '=', id).executeTakeFirst();
    return row ? normalizeCounts(row) : undefined;
  }

  async countActiveSuperusers(): Promise<number> {
    const row = await this.txHost.tx
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('role', '=', 'superuser')
      .where('isActive', '=', true)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  /** Locks the superuser rows so two concurrent demotions cannot both pass the "last superuser" check. */
  async lockSuperusers(): Promise<void> {
    await this.txHost.tx.selectFrom('users').select('id').where('role', '=', 'superuser').forUpdate().execute();
  }

  async insert(values: {
    username: string;
    passwordHash: string;
    role: Role;
    extension: string | null;
    email: string | null;
    mustChangePassword: boolean;
  }): Promise<number> {
    const row = await this.txHost.tx.insertInto('users').values(values).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async update(id: number, patch: UserPatch): Promise<void> {
    await this.txHost.tx
      .updateTable('users')
      .set({ ...patch, updatedAt: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  async setPassword(id: number, passwordHash: string, mustChangePassword: boolean): Promise<void> {
    await this.txHost.tx
      .updateTable('users')
      .set({ passwordHash, mustChangePassword, updatedAt: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  async delete(id: number): Promise<void> {
    await this.txHost.tx.deleteFrom('users').where('id', '=', id).execute();
  }
}

function normalizeCounts<T extends { passkeyCount: unknown; activeSessions: unknown }>(row: T): T & UserRow {
  return { ...row, passkeyCount: Number(row.passkeyCount ?? 0), activeSessions: Number(row.activeSessions ?? 0) } as T &
    UserRow;
}
