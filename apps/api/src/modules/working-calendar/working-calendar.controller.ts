import {
  type SessionUser,
  type WorkingCalendarInfo,
  type WorkingCalendarInput,
  WorkingCalendarInputSchema,
  WorkingCalendarSchema,
} from '@cc/shared';
import { Body, Controller, Get, Put, SerializeOptions } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators.js';
import { WorkingCalendarService } from './working-calendar.service.js';

/** Working days, hours and holidays: read by every signed-in user (UI hints), changed by `settings.manage`. */
@Controller('working-calendar')
export class WorkingCalendarController {
  constructor(private readonly calendar: WorkingCalendarService) {}

  @Get()
  @SerializeOptions({ schema: WorkingCalendarSchema })
  get(): WorkingCalendarInfo {
    return this.calendar.info();
  }

  @Put()
  @RequirePermission('settings.manage')
  @SerializeOptions({ schema: WorkingCalendarSchema })
  update(
    @Body({ schema: WorkingCalendarInputSchema }) body: WorkingCalendarInput,
    @CurrentUser() user: SessionUser,
  ): Promise<WorkingCalendarInfo> {
    return this.calendar.update(body, user);
  }
}
