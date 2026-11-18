import { Global, Module } from '@nestjs/common';
import { WorkingCalendarController } from './working-calendar.controller.js';
import { WorkingCalendarService } from './working-calendar.service.js';

/** The one working calendar (stats, callbacks, ticket deadlines). Global: any module may inject the service. */
@Global()
@Module({
  controllers: [WorkingCalendarController],
  providers: [WorkingCalendarService],
  exports: [WorkingCalendarService],
})
export class WorkingCalendarModule {}
