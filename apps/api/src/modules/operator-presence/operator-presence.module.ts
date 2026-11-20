import { Module } from '@nestjs/common';
import { LiveModule } from '../live/live.module.js';
import { OperatorPresenceRepository } from './operator-presence.repository.js';
import { OperatorPresenceService } from './operator-presence.service.js';

/**
 * Presence log: online / pause intervals of operator phones, recorded from the live state (AMI) for the staff KPI
 * page. Owns `operator_presence_log`; read through OperatorPresenceService.history().
 */
@Module({
  imports: [LiveModule],
  providers: [OperatorPresenceService, OperatorPresenceRepository],
  exports: [OperatorPresenceService],
})
export class OperatorPresenceModule {}
