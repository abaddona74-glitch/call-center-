import { Module } from '@nestjs/common';
import { LiveModule } from '../live/live.module.js';
import { SituationController } from './situation.controller.js';
import { SituationRepository } from './situation.repository.js';
import { SituationService } from './situation.service.js';

/**
 * The live situation board: read-only views over the live telephony store (LiveService) and the tickets tables,
 * pushed over WS to `situation.view` users. Owns no tables and performs no actions.
 */
@Module({
  imports: [LiveModule],
  controllers: [SituationController],
  providers: [SituationService, SituationRepository],
})
export class SituationModule {}
