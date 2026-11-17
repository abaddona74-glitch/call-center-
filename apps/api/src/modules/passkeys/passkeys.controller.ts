import {
  type MeResponse,
  type Passkey,
  PasskeyIdSchema,
  type PasskeyList,
  PasskeyListSchema,
  PasskeyLoginFinishSchema,
  PasskeyLoginResponseSchema,
  PasskeyRegistrationFinishSchema,
  type PasskeyRegistrationStart,
  PasskeyRegistrationStartSchema,
  type PasskeyRename,
  PasskeyRenameSchema,
  PasskeySchema,
  type SessionUser,
  UserIdParamSchema,
  type WebAuthnOptionsJSON,
  WebAuthnOptionsSchema,
} from '@cc/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, Public, Roles } from '../../common/decorators/auth.decorators.js';
import { AppConfig } from '../../config/app-config.js';
import { setSessionCookie } from '../auth/session-cookie.js';
import { UsersService } from '../users/users.service.js';
import { PasskeysService } from './passkeys.service.js';

/** Own passkeys + passwordless login. */
@Controller('auth/passkeys')
export class PasskeysController {
  constructor(
    private readonly passkeys: PasskeysService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  @SerializeOptions({ schema: PasskeyListSchema })
  async list(@CurrentUser() user: SessionUser): Promise<PasskeyList> {
    return { items: await this.passkeys.list(user.id) };
  }

  @Post('registration/options')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeOptions({ schema: WebAuthnOptionsSchema })
  registrationOptions(
    @CurrentUser() user: SessionUser,
    @Body({ schema: PasskeyRegistrationStartSchema }) body: PasskeyRegistrationStart,
    @Req() req: Request,
  ): Promise<WebAuthnOptionsJSON> {
    return this.passkeys.registrationOptions(user, body.password, body.name, req.ip);
  }

  @Post('registration/verify')
  @HttpCode(201)
  @SerializeOptions({ schema: PasskeySchema })
  registrationVerify(
    @CurrentUser() user: SessionUser,
    @Body({ schema: PasskeyRegistrationFinishSchema }) body: z.output<typeof PasskeyRegistrationFinishSchema>,
  ): Promise<Passkey> {
    return this.passkeys.registrationVerify(user, body.credential);
  }

  @Patch(':id')
  @SerializeOptions({ schema: PasskeySchema })
  rename(
    @CurrentUser() user: SessionUser,
    @Param('id', { schema: PasskeyIdSchema }) id: string,
    @Body({ schema: PasskeyRenameSchema }) body: PasskeyRename,
  ): Promise<Passkey> {
    return this.passkeys.rename(user.id, id, body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SessionUser, @Param('id', { schema: PasskeyIdSchema }) id: string): Promise<void> {
    await this.passkeys.remove(user.id, id, 'owner');
  }

  @Public()
  @Post('login/options')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @SerializeOptions({ schema: WebAuthnOptionsSchema })
  loginOptions(): Promise<WebAuthnOptionsJSON> {
    return this.passkeys.loginOptions();
  }

  @Public()
  @Post('login/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @SerializeOptions({ schema: PasskeyLoginResponseSchema })
  async loginVerify(
    @Body({ schema: PasskeyLoginFinishSchema }) body: z.output<typeof PasskeyLoginFinishSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const result = await this.passkeys.loginVerify(body.credential, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setSessionCookie(res, result.token, result.expiresAt, this.config.get('COOKIE_SECURE'));
    return { user: result.user };
  }
}

/** Passkeys of other users (admin+, same manage rules as the users admin). */
@Controller('users/:userId/passkeys')
@Roles('admin')
export class UserPasskeysController {
  constructor(
    private readonly passkeys: PasskeysService,
    private readonly users: UsersService,
  ) {}

  @Get()
  @SerializeOptions({ schema: PasskeyListSchema })
  async list(
    @CurrentUser() actor: SessionUser,
    @Param('userId', { schema: UserIdParamSchema }) userId: number,
  ): Promise<PasskeyList> {
    await this.users.assertCanManageCredentials(actor, userId);
    return { items: await this.passkeys.list(userId) };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: SessionUser,
    @Param('userId', { schema: UserIdParamSchema }) userId: number,
    @Param('id', { schema: PasskeyIdSchema }) id: string,
  ): Promise<void> {
    await this.users.assertCanManageCredentials(actor, userId);
    await this.passkeys.remove(userId, id, 'admin');
  }
}
