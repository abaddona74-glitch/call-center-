import type { OperatorGroup, Permissions, Role, UserListQuery } from '@cc/shared';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { type DbHost, InjectDb } from '../../database/db.js';
import { parseGroupPermissions } from '../auth/domain/session-user.js';

export interface UserRow {
  id: number;
  username: string;
  role: Role;
  extension: string | null;
  email: string | null;
  groupId: number | null;
  groupName: string | null;
  isActive: boolean;
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
  groupId?: number | null;
  isActive?: boolean;
}

@Injectable()
export class UsersRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  private baseQuery() {
    return this.txHost.tx
      .selectFrom('users as u')
      .leftJoin('operatorGroups as g', 'g.id', 'u.groupId')
      .select((eb) => [
        'u.id',
        'u.username',
        'u.role',
        'u.extension',
        'u.email',
        'u.groupId',
        'g.name as groupName',
        'u.isActive',
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
    const rows = await q.orderBy('u.role', 'desc').orderBy(sql`lower(u.username)`).execute();
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
    groupId: number | null;
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

  async setPassword(id: number, passwordHash: string): Promise<void> {
    await this.txHost.tx
      .updateTable('users')
      .set({ passwordHash, updatedAt: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  async delete(id: number): Promise<void> {
    await this.txHost.tx.deleteFrom('users').where('id', '=', id).execute();
  }

  // --- groups ----------------------------------------------------------------------------

  async listGroups(): Promise<OperatorGroup[]> {
    const rows = await this.groupQuery().orderBy(sql`lower(g.name)`).execute();
    return rows.map(toGroup);
  }

  async findGroup(id: number): Promise<OperatorGroup | undefined> {
    const row = await this.groupQuery().where('g.id', '=', id).executeTakeFirst();
    return row ? toGroup(row) : undefined;
  }

  async insertGroup(values: { name: string; description: string | null; permissions: Permissions }): Promise<number> {
    const row = await this.txHost.tx
      .insertInto('operatorGroups')
      .values({ ...values, permissions: JSON.stringify(values.permissions) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateGroup(
    id: number,
    patch: { name?: string; description?: string | null; permissions?: Permissions },
  ): Promise<void> {
    const { permissions, ...rest } = patch;
    await this.txHost.tx
      .updateTable('operatorGroups')
      .set({
        ...rest,
        ...(permissions ? { permissions: JSON.stringify(permissions) } : {}),
        updatedAt: sql`now()`,
      })
      .where('id', '=', id)
      .execute();
  }

  async deleteGroup(id: number): Promise<void> {
    await this.txHost.tx.deleteFrom('operatorGroups').where('id', '=', id).execute();
  }

  async groupMemberIds(groupId: number): Promise<number[]> {
    const rows = await this.txHost.tx.selectFrom('users').select('id').where('groupId', '=', groupId).execute();
    return rows.map((r) => r.id);
  }

  private groupQuery() {
    return this.txHost.tx
      .selectFrom('operatorGroups as g')
      .select((eb) => [
        'g.id',
        'g.name',
        'g.description',
        'g.permissions',
        'g.createdAt',
        'g.updatedAt',
        eb
          .selectFrom('users as u')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('u.groupId', '=', 'g.id')
          .as('memberCount'),
      ]);
  }
}

function normalizeCounts<T extends { passkeyCount: unknown; activeSessions: unknown }>(row: T): T & UserRow {
  return { ...row, passkeyCount: Number(row.passkeyCount ?? 0), activeSessions: Number(row.activeSessions ?? 0) } as T &
    UserRow;
}

function toGroup(row: {
  id: number;
  name: string;
  description: string | null;
  permissions: unknown;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number | null;
}): OperatorGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: parseGroupPermissions(row.permissions),
    memberCount: Number(row.memberCount ?? 0),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
