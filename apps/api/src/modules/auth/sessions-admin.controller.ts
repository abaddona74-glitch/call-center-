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
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { canManage } from '../users/domain/user-policy.js';
import { SessionManager } from './session-manager.service.js';

/**
 * Active sessions of everybody (admin+). Admins see operators' sessions and their own;
 * superusers see all. Ids are sha256(token) — tokens are never stored or shown.
 */
@Controller('sessions')
@Roles('admin')
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
        .filter((r) => r.userId === user.id || canManage(user, r))
        .map((r) => this.sessions.toInfo(r, current, r.userId === user.id || canManage(user, r))),
    };
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: SessionUser, @Param('id', { schema: SessionIdSchema }) id: string): Promise<void> {
    const row = await this.sessions.findSession(id);
    if (!row) throw new NotFoundException('Session not found');
    if (row.userId !== user.id && !canManage(user, row)) throw new ForbiddenException('You cannot manage this account');
    if (id === this.cls.get('sessionId')) throw new BadRequestException('Use logout to end the current session');
    await this.sessions.revokeSession(id, 'revoked_by_admin');
    await this.audit.record('sessions.revoke', {
      target: `user:${row.userId}`,
      details: { session: id.slice(0, 12), username: row.username, ip: row.ip },
    });
  }
}
