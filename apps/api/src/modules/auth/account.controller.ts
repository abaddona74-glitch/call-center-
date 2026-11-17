import {
  type ChangePasswordRequest,
  ChangePasswordRequestSchema,
  type ChangePasswordResponse,
  ChangePasswordResponseSchema,
  type EmailChangeStart,
  EmailChangeStartSchema,
  type EmailChangeStatus,
  EmailChangeStatusSchema,
  EmailChangeVerifySchema,
  type PasswordResetComplete,
  PasswordResetCompleteSchema,
  type PasswordResetRequest,
  PasswordResetRequestSchema,
  type PasswordResetRequested,
  PasswordResetRequestedSchema,
  type PasswordResetVerified,
  PasswordResetVerifiedSchema,
  type PasswordResetVerify,
  PasswordResetVerifySchema,
  SessionIdSchema,
  type SessionList,
  SessionListSchema,
  type SessionUser,
} from '@cc/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  SerializeOptions,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls/app-cls.js';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators.js';
import { AccountService } from './account.service.js';
import { SessionManager } from './session-manager.service.js';

/** Self-service: own password, password reset by email, email binding, own sessions. */
@Controller('auth')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly sessions: SessionManager,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Post('password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeOptions({ schema: ChangePasswordResponseSchema })
  changePassword(
    @CurrentUser() user: SessionUser,
    @Body({ schema: ChangePasswordRequestSchema }) body: Required<ChangePasswordRequest>,
    @Req() req: Request,
  ): Promise<ChangePasswordResponse> {
    return this.account.changePassword(user.id, this.cls.get('sessionId')!, body, req.ip);
  }

  // --- password reset (anonymous) ---

  @Public()
  @Post('password-reset/request')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @SerializeOptions({ schema: PasswordResetRequestedSchema })
  requestReset(
    @Body({ schema: PasswordResetRequestSchema }) body: PasswordResetRequest,
    @Req() req: Request,
  ): Promise<PasswordResetRequested> {
    return this.account.requestPasswordReset(body.identifier, req.ip);
  }

  @Public()
  @Post('password-reset/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeOptions({ schema: PasswordResetVerifiedSchema })
  verifyReset(@Body({ schema: PasswordResetVerifySchema }) body: PasswordResetVerify): Promise<PasswordResetVerified> {
    return this.account.verifyPasswordReset(body.identifier, body.code);
  }

  @Public()
  @Post('password-reset/complete')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async completeReset(@Body({ schema: PasswordResetCompleteSchema }) body: PasswordResetComplete): Promise<void> {
    await this.account.completePasswordReset(body.resetToken, body.newPassword);
  }

  // --- email binding ---

  @Get('email')
  @SerializeOptions({ schema: EmailChangeStatusSchema })
  emailStatus(@CurrentUser() user: SessionUser): Promise<EmailChangeStatus> {
    return this.account.emailStatus(user.id);
  }

  @Post('email/start')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeOptions({ schema: EmailChangeStatusSchema })
  startEmail(
    @CurrentUser() user: SessionUser,
    @Body({ schema: EmailChangeStartSchema }) body: EmailChangeStart,
    @Req() req: Request,
  ): Promise<EmailChangeStatus> {
    return this.account.startEmailChange(user.id, body, req.ip);
  }

  @Post('email/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeOptions({ schema: EmailChangeStatusSchema })
  verifyEmail(
    @CurrentUser() user: SessionUser,
    @Body({ schema: EmailChangeVerifySchema }) body: { code: string },
    @Req() req: Request,
  ): Promise<EmailChangeStatus> {
    return this.account.verifyEmailChange(user.id, body.code, req.ip);
  }

  @Delete('email/pending')
  @HttpCode(204)
  async cancelEmail(@CurrentUser() user: SessionUser): Promise<void> {
    await this.account.cancelEmailChange(user.id);
  }

  // --- own sessions ---

  @Get('sessions')
  @SerializeOptions({ schema: SessionListSchema })
  async mySessions(@CurrentUser() user: SessionUser): Promise<SessionList> {
    const current = this.cls.get('sessionId');
    const rows = await this.sessions.listActive({ userId: user.id });
    return { items: rows.map((r) => this.sessions.toInfo(r, current, true)) };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeMine(
    @CurrentUser() user: SessionUser,
    @Param('id', { schema: SessionIdSchema }) id: string,
  ): Promise<void> {
    const row = await this.sessions.findSession(id);
    // Someone else's session looks exactly like a missing one.
    if (!row || row.userId !== user.id || id === this.cls.get('sessionId'))
      throw new NotFoundException('Session not found');
    await this.sessions.revokeSession(id, 'revoked_by_owner');
  }
}
