import { Module } from '@nestjs/common';
import { LiveModule } from '../live/live.module.js';
import { ActionsController } from './actions.controller.js';
import { ActionsService } from './actions.service.js';

/** Pause / transfer / hangup / click-to-call via AMI, with per-role rules and audit. */
@Module({
  imports: [LiveModule],
  controllers: [ActionsController],
  providers: [ActionsService],
  exports: [ActionsService],
})
export class ActionsModule {}
