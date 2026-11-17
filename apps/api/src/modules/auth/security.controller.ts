import {
  type LockoutList,
  LockoutListSchema,
  type LockoutSettings,
  LockoutSettingsSchema,
  type UnlockResult,
  UnlockResultSchema,
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
  Put,
  SerializeOptions,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthSettingsService } from './auth-settings.service.js';
import { LoginThrottleService } from './login-throttle.service.js';

const LockoutIdSchema = z.coerce.number().int().positive();

/** Login protection settings (superuser edits, admin reads) and active lockouts (admin+). */
@Controller('security')
@RequirePermission('security.manage')
export class SecurityController {
  constructor(
    private readonly settings: AuthSettingsService,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
  ) {}

  @Get('settings')
  @SerializeOptions({ schema: LockoutSettingsSchema })
  getSettings(): Promise<LockoutSettings> {
    return this.settings.getLockout();
  }

  @Put('settings')
  @SerializeOptions({ schema: LockoutSettingsSchema })
  async putSettings(@Body({ schema: LockoutSettingsSchema }) body: LockoutSettings): Promise<LockoutSettings> {
    const before = await this.settings.getLockout();
    const saved = await this.settings.setLockout(body);
    await this.audit.record('settings.security.update', {
      target: 'settings:lockout',
      details: { before, after: saved },
    });
    return saved;
  }

  @Get('lockouts')
  @SerializeOptions({ schema: LockoutListSchema })
  async lockouts(): Promise<LockoutList> {
    return { items: await this.throttle.listLocked() };
  }

  @Delete('lockouts/:id')
  @HttpCode(204)
  async unlock(@Param('id', { schema: LockoutIdSchema }) id: number): Promise<void> {
    const row = await this.throttle.findById(id);
    if (!row) throw new NotFoundException('Lockout not found');
    await this.throttle.unlock(id);
    await this.audit.record('security.unlock', {
      target: row.username ? `username:${row.username}` : `ip:${row.ip}`,
      details: { kind: row.kind, ip: row.ip },
    });
  }

  @Post('lockouts/clear')
  @HttpCode(200)
  @SerializeOptions({ schema: UnlockResultSchema })
  async unlockAll(): Promise<UnlockResult> {
    const unlocked = await this.throttle.unlockAll();
    await this.audit.record('security.unlock_all', { details: { unlocked } });
    return { unlocked };
  }
}
