import { Module } from '@nestjs/common';
import { PbxCallsModule } from '../../pbx/calls/pbx-calls.module.js';
import { OverviewController } from './overview.controller.js';
import { OverviewRepository } from './overview.repository.js';
import { OverviewService } from './overview.service.js';

/**
 * Overview dashboard: read-only aggregates over the tickets tables and the CDR (via the shared PbxCallsModule).
 * Owns no tables.
 */
@Module({
  imports: [PbxCallsModule],
  controllers: [OverviewController],
  providers: [OverviewService, OverviewRepository],
})
export class OverviewModule {}
