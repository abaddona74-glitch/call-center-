import type { ResetUserPasswordResult, SessionUser, User, UserListQuery } from '@cc/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../auth/password-hasher.js';
import { SessionManager } from '../auth/session-manager.service.js';
import {
  type PolicyResult,
  canImpersonate,
  canManage,
  checkCreate,
  checkCredentialsAdmin,
  checkDelete,
  checkUpdate,
} from './domain/user-policy.js';
import { type UserPatch, type UserRow, UsersRepository } from './users.repository.js';

type Actor = Pick<SessionUser, 'id' | 'role' | 'permissions'>;

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
    throw new ConflictException('Already exists');
  }
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
      isActive: row.isActive,
      mustChangePassword: row.mustChangePassword,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
      passkeyCount: row.passkeyCount,
      activeSessions: row.activeSessions,
      canManage: actor.id !== row.id && canManage(actor, row),
      canImpersonate: canImpersonate(actor, row),
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
      mustChangePassword: boolean;
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
        mustChangePassword: body.mustChangePassword,
      })
      .catch(mapDbError);
    await this.audit.record('users.create', {
      target: `user:${id}`,
      details: {
        username: body.username,
        role: body.role,
        extension: body.extension,
        email: body.email,
        mustChangePassword: body.mustChangePassword,
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
    enforce(checkUpdate(actor, target, { role: patch.role, isActive: patch.isActive }, activeSuperusers));

    const finalRole = patch.role ?? target.role;
    const finalExtension = patch.extension !== undefined ? patch.extension : target.extension;
    if (finalRole === 'operator' && !finalExtension) throw new BadRequestException('Operators need an extension');

    const changes = diff(target, patch);
    if (Object.keys(changes).length === 0) return this.toDto(target, actor);
    await this.repo.update(id, patch).catch(mapDbError);

    if (deactivating) await this.sessions.revokeUserSessions(id, 'account_disabled');
    else if (roleChange) this.sessions.refreshSockets(id, 'account_changed');

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
    body: { password: string; revokePasskeys: boolean; mustChangePassword: boolean },
  ): Promise<ResetUserPasswordResult> {
    const target = await this.load(id);
    enforce(checkCredentialsAdmin(actor, target));
    await this.repo.setPassword(id, await hashPassword(body.password), body.mustChangePassword);
    const revokedPasskeys = body.revokePasskeys ? await this.sessions.revokeUserPasskeys(id, 'password_reset') : 0;
    const revokedSessions = await this.sessions.revokeUserSessions(id, 'password_reset');
    await this.audit.record('users.password_reset', {
      target: `user:${id}`,
      details: {
        username: target.username,
        revokedSessions,
        revokedPasskeys,
        mustChangePassword: body.mustChangePassword,
      },
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
