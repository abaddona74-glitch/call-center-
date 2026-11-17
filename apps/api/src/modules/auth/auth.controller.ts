import {
  type AuthOptions,
  AuthOptionsSchema,
  LoginRequestSchema,
  type LoginRequest,
  type MeResponse,
  MeResponseSchema,
  type SessionUser,
} from '@cc/shared';
import { Body, Controller, Get, HttpCode, Post, Req, Res, SerializeOptions } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls/app-cls.js';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators.js';
import { AppConfig } from '../../config/app-config.js';
import { MailService } from '../mail/mail.service.js';
import { AuthService } from './auth.service.js';
import { clearSessionCookie, setSessionCookie } from './session-cookie.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
    private readonly cls: ClsService<AppClsStore>,
    private readonly mail: MailService,
  ) {}

  /** What the login screen may offer (passkey button, "forgot password"). */
  @Public()
  @SkipThrottle()
  @Get('options')
  @SerializeOptions({ schema: AuthOptionsSchema })
  options(): AuthOptions {
    return {
      passkeys: Boolean(this.config.get('WEBAUTHN_RP_ID')) && this.config.get('WEBAUTHN_ORIGINS').length > 0,
      passwordReset: this.mail.enabled,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeOptions({ schema: MeResponseSchema })
  async login(
    @Body({ schema: LoginRequestSchema }) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const result = await this.auth.login(body.username, body.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setSessionCookie(res, result.token, result.expiresAt, this.config.get('COOKIE_SECURE'));
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) res: Response): Promise<void> {
    const sessionId = this.cls.get('sessionId');
    if (sessionId) await this.auth.logout(sessionId);
    clearSessionCookie(res);
  }

  @Get('me')
  @SerializeOptions({ schema: MeResponseSchema })
  me(@CurrentUser() user: SessionUser): MeResponse {
    return { user };
  }
}
