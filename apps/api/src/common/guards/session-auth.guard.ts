import { type Role, hasRoleAtLeast } from '@cc/shared';
import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { SessionsService } from '../../modules/auth/sessions.service.js';
import type { AppClsStore } from '../cls/app-cls.js';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../decorators/auth.decorators.js';
import { extractSessionToken } from '../http/cookies.js';

/**
 * Global guard: every HTTP route requires a valid session unless marked @Public().
 * Then enforces @Roles(minimum) if present. Puts the user into CLS for the rest of the request.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true; // WebSocket auth is done in the gateway
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const session = await this.sessions.validate(extractSessionToken(req));
    if (!session) throw new UnauthorizedException('Authentication required');

    req.user = session.user;
    this.cls.set('user', session.user);
    this.cls.set('sessionId', session.sessionId);

    const minimum = this.reflector.getAllAndOverride<Role | undefined>(ROLES_KEY, targets);
    if (minimum && !hasRoleAtLeast(session.user.role, minimum)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
