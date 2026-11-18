import {
  type ImpersonationStart,
  ImpersonationStartSchema,
  type MeResponse,
  MeResponseSchema,
  type SessionUser,
} from '@cc/shared';
import { Body, Controller, Delete, HttpCode, Post, Req, Res, SerializeOptions } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls/app-cls.js';
import {
  AllowWhilePasswordChangeRequired,
  CurrentUser,
  DenyWhileImpersonating,
  RequirePermission,
} from '../../common/decorators/auth.decorators.js';
import { AppConfig } from '../../config/app-config.js';
import { ImpersonationService } from './impersonation.service.js';
import { clearSessionCookie, setSessionCookie } from './session-cookie.js';

/** "Log in as another user": POST starts (permission `impersonate`), DELETE returns to the own account. */
@Controller('auth/impersonation')
export class ImpersonationController {
  constructor(
    private readonly impersonation: ImpersonationService,
    private readonly config: AppConfig,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Post()
  @HttpCode(200)
  @RequirePermission('impersonate')
  @DenyWhileImpersonating()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeOptions({ schema: MeResponseSchema })
  async start(
    @CurrentUser() actor: SessionUser,
    @Body({ schema: ImpersonationStartSchema }) body: ImpersonationStart,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const result = await this.impersonation.start(actor, this.cls.get('sessionId')!, body.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setSessionCookie(res, result.token, result.expiresAt, this.config.get('COOKIE_SECURE'));
    return { user: result.user };
  }

  /** 200 with the superuser back, or 204 (signed out) when they can no longer sign in. */
  @Delete()
  @AllowWhilePasswordChangeRequired()
  async stop(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse | undefined> {
    const result = await this.impersonation.stop(user, this.cls.get('sessionId')!, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    if (!result) {
      clearSessionCookie(res);
      res.status(204);
      return undefined;
    }
    setSessionCookie(res, result.token, result.expiresAt, this.config.get('COOKIE_SECURE'));
    // validated here (not with @SerializeOptions) because the 204 branch has no body
    return MeResponseSchema.parse({ user: result.user });
  }
}
