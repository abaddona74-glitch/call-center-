import { type GroupFlag, type Permission, type RoleLevel, hasPermission, hasRoleAtLeast } from '@cc/shared';
import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { SessionsService } from '../../modules/auth/sessions.service.js';
import type { AppClsStore } from '../cls/app-cls.js';
import {
  ALLOW_PASSWORD_CHANGE_PENDING_KEY,
  DENY_IMPERSONATION_KEY,
  IS_PUBLIC_KEY,
  PERMISSION_KEY,
  ROLES_KEY,
} from '../decorators/auth.decorators.js';
import { extractSessionToken } from '../http/cookies.js';

/** Message of the 403 sent while a forced password change is pending (the web app checks it). */
export const PASSWORD_CHANGE_REQUIRED = 'Password change required';

/**
 * Global guard: every HTTP route requires a valid session unless marked @Public().
 * Then, in order: forced password change, impersonation restrictions, @Roles (compat), @RequirePermission.
 * Puts the user into CLS for the rest of the request.
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
    const { user } = session;

    req.user = user;
    this.cls.set('user', user);
    this.cls.set('sessionId', session.sessionId);

    // A superuser acting as the user is not the account owner and is never forced to change its password.
    if (
      user.mustChangePassword &&
      !user.impersonation &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_PENDING_KEY, targets)
    ) {
      throw new ForbiddenException(PASSWORD_CHANGE_REQUIRED);
    }
    if (user.impersonation && this.reflector.getAllAndOverride<boolean>(DENY_IMPERSONATION_KEY, targets)) {
      throw new ForbiddenException('Not allowed while acting as another user');
    }

    const minimum = this.reflector.getAllAndOverride<RoleLevel | undefined>(ROLES_KEY, targets);
    if (minimum && !hasRoleAtLeast(user.role, minimum)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const permission = this.reflector.getAllAndOverride<Permission | GroupFlag | undefined>(PERMISSION_KEY, targets);
    if (permission && !hasPermission(user, permission)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
