import { SessionIdSchema, type SessionList, SessionListSchema, type SessionUser } from '@cc/shared';
import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  SerializeOptions,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls/app-cls.js';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionManager } from './session-manager.service.js';

/**
 * Active sessions of everybody (permission `sessions.manage`). Superusers' sessions are visible and
 * revocable only for superusers. Ids are sha256(token) — tokens are never stored or shown.
 */
@Controller('sessions')
@RequirePermission('sessions.manage')
export class SessionsAdminController {
  constructor(
    private readonly sessions: SessionManager,
    private readonly audit: AuditService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get()
  @SerializeOptions({ schema: SessionListSchema })
  async list(@CurrentUser() user: SessionUser): Promise<SessionList> {
    const current = this.cls.get('sessionId');
    const rows = await this.sessions.listActive();
    return {
      items: rows
        .filter((r) => this.visible(user, r))
        .map((r) => this.sessions.toInfo(r, current, this.visible(user, r))),
    };
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: SessionUser, @Param('id', { schema: SessionIdSchema }) id: string): Promise<void> {
    const row = await this.sessions.findSession(id);
    if (!row) throw new NotFoundException('Session not found');
    if (!this.visible(user, row)) throw new ForbiddenException('You cannot manage this account');
    if (id === this.cls.get('sessionId')) throw new BadRequestException('Use logout to end the current session');
    await this.sessions.revokeSession(id, 'revoked_by_admin');
    await this.audit.record('sessions.revoke', {
      target: `user:${row.userId}`,
      details: { session: id.slice(0, 12), username: row.username, ip: row.ip },
    });
  }

  private visible(user: SessionUser, row: { userId: number; role: SessionUser['role'] }): boolean {
    return row.userId === user.id || user.role === 'superuser' || row.role !== 'superuser';
  }
}
