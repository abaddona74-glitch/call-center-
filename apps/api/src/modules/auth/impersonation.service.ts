import { IMPERSONATION_MINUTES, type SessionUser } from '@cc/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { checkImpersonate } from '../users/domain/user-policy.js';
import { AuthRepository } from './auth.repository.js';
import type { LoginResult, RequestMeta } from './auth.service.js';
import { buildSessionUser } from './domain/session-user.js';
import { SessionManager } from './session-manager.service.js';
import { SessionsService } from './sessions.service.js';

/**
 * "Log in as another user" (owner decision: superuser only, audited, visible banner, time-limited).
 * It is a NEW session of the target user, linked to the superuser and to the superuser's own session
 * (`impersonator_user_id`, `parent_session_id`); it ends after IMPERSONATION_MINUTES, when stopped,
 * or as soon as the superuser's own session ends. No token is ever copied or shown.
 */
@Injectable()
export class ImpersonationService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly sessions: SessionsService,
    private readonly sessionManager: SessionManager,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  async start(actor: SessionUser, actorSessionId: string, targetId: number, meta: RequestMeta): Promise<LoginResult> {
    if (actor.impersonation) throw new ConflictException('Stop acting as the current user first');
    const target = await this.repo.findById(targetId);
    if (!target) throw new NotFoundException('User not found');
    const verdict = checkImpersonate(actor, target);
    if (!verdict.ok) throw new ForbiddenException(verdict.reason);

    const session = await this.sessions.create(target.id, {
      ...meta,
      impersonation: { byUserId: actor.id, parentSessionId: actorSessionId, ttlMs: IMPERSONATION_MINUTES * 60_000 },
    });
    await this.audit.record('auth.impersonate.start', {
      target: `user:${target.id}`,
      details: { username: target.username, role: target.role, minutes: IMPERSONATION_MINUTES },
    });
    const user = buildSessionUser(target, {
      by: { id: actor.id, username: actor.username },
      expiresAt: session.expiresAt,
    });
    return { user, ...session };
  }

  /**
   * Ends the impersonation and opens a fresh session for the superuser (their old one is retired too).
   * Returns null when the superuser can no longer sign in (account disabled/demoted, own session gone).
   */
  async stop(user: SessionUser, sessionId: string, meta: RequestMeta): Promise<LoginResult | null> {
    if (!user.impersonation) throw new BadRequestException('Not acting as another user');
    const row = await this.sessionManager.findSession(sessionId);
    const parentId = row?.parentSessionId ?? null;
    const parent = parentId ? await this.sessionManager.findSession(parentId) : undefined;
    const impersonator = await this.repo.findById(user.impersonation.by.id);

    await this.audit.record('auth.impersonate.stop', {
      target: `user:${user.id}`,
      details: { username: user.username },
    });
    await this.sessionManager.revokeSession(sessionId, 'impersonation_stopped');
    if (parentId) await this.sessionManager.revokeSession(parentId, 'impersonation_stopped');

    if (!impersonator?.isActive || impersonator.role !== 'superuser' || !parent) return null;
    const session = await this.sessions.create(impersonator.id, meta);
    return { user: buildSessionUser(impersonator), ...session };
  }

  /** Logout while acting as someone: end the superuser's own (cookie-less) session as well. */
  async endOnLogout(sessionId: string): Promise<void> {
    const row = await this.sessionManager.findSession(sessionId);
    if (row?.parentSessionId) await this.sessionManager.revokeSession(row.parentSessionId, 'logout');
    this.realtime.terminate({ sessionId }, 'logout');
  }
}
