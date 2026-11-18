import { type OnlineUser, OnlineUserSchema, type SessionUser, telephonyAccess } from '@cc/shared';
import { Controller, ForbiddenException, Get, SerializeOptions } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import { PresenceService } from './presence.service.js';

@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  /** Users connected right now (not operators). Updates: WS `presence.online`. */
  @Get('online')
  @SkipThrottle()
  @SerializeOptions({ schema: OnlineUserSchema }) // arrays are validated item by item
  online(@CurrentUser() user: SessionUser): OnlineUser[] {
    if (!telephonyAccess(user).seeAll) throw new ForbiddenException('Insufficient permissions');
    return this.presence.online();
  }
}
