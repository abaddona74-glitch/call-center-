import { Module } from '@nestjs/common';
import { PbxCallsModule } from '../../pbx/calls/pbx-calls.module.js';
import { CallAnalysisModule } from '../call-analysis/call-analysis.module.js';
import { OverviewController } from './overview.controller.js';
import { OverviewRepository } from './overview.repository.js';
import { OverviewService } from './overview.service.js';

/**
 * Overview dashboard: read-only aggregates over the tickets tables, the CDR (via the shared PbxCallsModule) and the AI
 * call analysis (CallAnalysisService.stats, aggregates only).
 * Owns no tables.
 */
@Module({
  imports: [PbxCallsModule, CallAnalysisModule],
  controllers: [OverviewController],
  providers: [OverviewService, OverviewRepository],
})
export class OverviewModule {}
