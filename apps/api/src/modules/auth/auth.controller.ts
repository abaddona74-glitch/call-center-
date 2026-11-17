import { LoginRequestSchema, type LoginRequest, type MeResponse, MeResponseSchema, type SessionUser } from '@cc/shared';
import { Body, Controller, Get, HttpCode, Post, Req, Res, SerializeOptions } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls/app-cls.js';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators.js';
import { SESSION_COOKIE } from '../../common/http/cookies.js';
import { AppConfig } from '../../config/app-config.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

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
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE'),
      sameSite: 'lax',
      path: '/',
      expires: result.expiresAt,
    });
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) res: Response): Promise<void> {
    const sessionId = this.cls.get('sessionId');
    if (sessionId) await this.auth.logout(sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @SerializeOptions({ schema: MeResponseSchema })
  me(@CurrentUser() user: SessionUser): MeResponse {
    return { user };
  }
}
