import { Module } from '@nestjs/common';
import { LiveController } from './live.controller.js';
import { LiveRepository } from './live.repository.js';
import { LiveService } from './live.service.js';

/** Live telephony state from AMI: operators' presence, active calls, queues, today's counters. */
@Module({
  controllers: [LiveController],
  providers: [LiveService, LiveRepository],
  exports: [LiveService],
})
export class LiveModule {}
