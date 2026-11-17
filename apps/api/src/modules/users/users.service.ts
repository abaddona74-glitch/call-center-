import type {
  CreateOperatorGroupSchema,
  OperatorGroup,
  ResetUserPasswordResult,
  SessionUser,
  User,
  UserListQuery,
} from '@cc/shared';
import { PermissionsSchema } from '@cc/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../auth/password-hasher.js';
import { SessionManager } from '../auth/session-manager.service.js';
import {
  type PolicyResult,
  canManage,
  checkCreate,
  checkCredentialsAdmin,
  checkDelete,
  checkUpdate,
} from './domain/user-policy.js';
import { type UserPatch, type UserRow, UsersRepository } from './users.repository.js';

type Actor = Pick<SessionUser, 'id' | 'role'>;

function enforce(result: PolicyResult): void {
  if (result.ok) return;
  throw result.status === 409 ? new ConflictException(result.reason) : new ForbiddenException(result.reason);
}

/** Postgres constraint errors -> HTTP errors with a readable message. */
function mapDbError(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === '23505') {
    if (e.constraint?.includes('email')) throw new ConflictException('This email is used by another account');
    if (e.constraint?.includes('username')) throw new ConflictException('This username is taken');
    if (e.constraint?.includes('operator_groups')) throw new ConflictException('A group with this name exists');
    throw new ConflictException('Already exists');
  }
  if (e?.code === '23503') throw new BadRequestException('Operator group not found');
  throw err;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly sessions: SessionManager,
    private readonly audit: AuditService,
  ) {}

  toDto(row: UserRow, actor: Actor): User {
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      extension: row.extension,
      email: row.email,
      groupId: row.groupId,
      groupName: row.groupName,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
      passkeyCount: row.passkeyCount,
      activeSessions: row.activeSessions,
      canManage: actor.id !== row.id && canManage(actor, row),
    };
  }

  async list(actor: Actor, query: UserListQuery): Promise<User[]> {
    const rows = await this.repo.list(query);
    return rows.map((r) => this.toDto(r, actor));
  }

  async get(actor: Actor, id: number): Promise<User> {
    return this.toDto(await this.load(id), actor);
  }

  @Transactional()
  async create(
    actor: Actor,
    body: {
      username: string;
      password: string;
      role: User['role'];
      extension: string | null;
      email: string | null;
      groupId: number | null;
    },
  ): Promise<User> {
    enforce(checkCreate(actor, body.role));
    const id = await this.repo
      .insert({
        username: body.username,
        passwordHash: await hashPassword(body.password),
        role: body.role,
        extension: body.extension,
        email: body.email,
        groupId: body.groupId,
      })
      .catch(mapDbError);
    await this.audit.record('users.create', {
      target: `user:${id}`,
      details: {
        username: body.username,
        role: body.role,
        extension: body.extension,
        email: body.email,
        groupId: body.groupId,
      },
    });
    return this.toDto(await this.load(id), actor);
  }

  @Transactional()
  async update(actor: Actor, id: number, patch: UserPatch): Promise<User> {
    const target = await this.load(id);
    const roleChange = patch.role !== undefined && patch.role !== target.role;
    const deactivating = patch.isActive === false && target.isActive;
    if (target.role === 'superuser' && (roleChange || deactivating)) await this.repo.lockSuperusers();
    const activeSuperusers = await this.repo.countActiveSuperusers();
    enforce(checkUpdate(actor, target, { role: patch.role, isActive: patch.isActive, other: true }, activeSuperusers));

    const finalRole = patch.role ?? target.role;
    const finalExtension = patch.extension !== undefined ? patch.extension : target.extension;
    if (finalRole === 'operator' && !finalExtension) throw new BadRequestException('Operators need an extension');

    const changes = diff(target, patch);
    if (Object.keys(changes).length === 0) return this.toDto(target, actor);
    await this.repo.update(id, patch).catch(mapDbError);

    if (deactivating) await this.sessions.revokeUserSessions(id, 'account_disabled');
    else if (roleChange || patch.groupId !== undefined) this.sessions.refreshSockets(id, 'account_changed');

    await this.audit.record(deactivating ? 'users.deactivate' : roleChange ? 'users.role_change' : 'users.update', {
      target: `user:${id}`,
      details: { username: target.username, changes },
    });
    return this.toDto(await this.load(id), actor);
  }

  @Transactional()
  async resetPassword(
    actor: Actor,
    id: number,
    body: { password: string; revokePasskeys: boolean },
  ): Promise<ResetUserPasswordResult> {
    const target = await this.load(id);
    enforce(checkCredentialsAdmin(actor, target));
    await this.repo.setPassword(id, await hashPassword(body.password));
    const revokedPasskeys = body.revokePasskeys ? await this.sessions.revokeUserPasskeys(id, 'password_reset') : 0;
    const revokedSessions = await this.sessions.revokeUserSessions(id, 'password_reset');
    await this.audit.record('users.password_reset', {
      target: `user:${id}`,
      details: { username: target.username, revokedSessions, revokedPasskeys },
    });
    return { revokedSessions, revokedPasskeys };
  }

  @Transactional()
  async remove(actor: Actor, id: number): Promise<void> {
    const target = await this.load(id);
    if (target.role === 'superuser') await this.repo.lockSuperusers();
    enforce(checkDelete(actor, target, await this.repo.countActiveSuperusers()));
    await this.sessions.revokeUserSessions(id, 'account_deleted');
    await this.repo.delete(id);
    await this.audit.record('users.delete', {
      target: `user:${id}`,
      details: { username: target.username, role: target.role, extension: target.extension },
    });
  }

  /** Used by the passkeys admin endpoints: the target must be manageable by the actor. */
  async assertCanManageCredentials(actor: Actor, id: number): Promise<UserRow> {
    const target = await this.load(id);
    enforce(checkCredentialsAdmin(actor, target));
    return target;
  }

  // --- operator groups ---------------------------------------------------------------------

  listGroups(): Promise<OperatorGroup[]> {
    return this.repo.listGroups();
  }

  @Transactional()
  async createGroup(body: z.output<typeof CreateOperatorGroupSchema>): Promise<OperatorGroup> {
    const permissions = PermissionsSchema.parse(body.permissions);
    const id = await this.repo
      .insertGroup({ name: body.name, description: body.description, permissions })
      .catch(mapDbError);
    await this.audit.record('groups.create', { target: `group:${id}`, details: { name: body.name, permissions } });
    return (await this.repo.findGroup(id))!;
  }

  @Transactional()
  async updateGroup(
    id: number,
    patch: { name?: string; description?: string | null; permissions?: OperatorGroup['permissions'] },
  ): Promise<OperatorGroup> {
    const before = await this.repo.findGroup(id);
    if (!before) throw new NotFoundException('Group not found');
    await this.repo.updateGroup(id, patch).catch(mapDbError);
    const after = (await this.repo.findGroup(id))!;
    if (patch.permissions) {
      // Connected clients of members reload with the new permissions.
      for (const userId of await this.repo.groupMemberIds(id))
        this.sessions.refreshSockets(userId, 'permissions_changed');
    }
    await this.audit.record('groups.update', {
      target: `group:${id}`,
      details: {
        before: { name: before.name, description: before.description, permissions: before.permissions },
        after: { name: after.name, description: after.description, permissions: after.permissions },
      },
    });
    return after;
  }

  @Transactional()
  async deleteGroup(id: number): Promise<void> {
    const group = await this.repo.findGroup(id);
    if (!group) throw new NotFoundException('Group not found');
    const members = await this.repo.groupMemberIds(id);
    await this.repo.deleteGroup(id);
    for (const userId of members) this.sessions.refreshSockets(userId, 'permissions_changed');
    await this.audit.record('groups.delete', {
      target: `group:${id}`,
      details: { name: group.name, members: members.length },
    });
  }

  private async load(id: number): Promise<UserRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('User not found');
    return row;
  }
}

function diff(before: UserRow, patch: UserPatch): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(patch) as (keyof UserPatch)[]) {
    const to = patch[key];
    if (to === undefined) continue;
    const from = before[key];
    if (from !== to) out[key] = { from, to };
  }
  return out;
}
