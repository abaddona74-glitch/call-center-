import { type LiveSnapshot, LiveSnapshotSchema, type SessionUser } from '@cc/shared';
import { Controller, Get, SerializeOptions } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators.js';
import { LiveService } from './live.service.js';

@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  /**
   * Initial state for the dashboard / operators page; afterwards the client applies
   * `telephony.*` WS events. Filtered by role (operators: masked numbers, no counters).
   */
  @Get('snapshot')
  @RequirePermission('monitor.view')
  @SkipThrottle()
  @SerializeOptions({ schema: LiveSnapshotSchema })
  snapshot(@CurrentUser() user: SessionUser): LiveSnapshot {
    return this.live.snapshot(user);
  }
}
