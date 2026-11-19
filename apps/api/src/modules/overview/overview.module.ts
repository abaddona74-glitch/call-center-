import { Module } from '@nestjs/common';
import { PbxCallsModule } from '../../pbx/calls/pbx-calls.module.js';
import { CallAnalysisModule } from '../call-analysis/call-analysis.module.js';
import { CdrModule } from '../cdr/cdr.module.js';
import { RecordingsModule } from '../recordings/recordings.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { OverviewController } from './overview.controller.js';
import { OverviewRepository } from './overview.repository.js';
import { OverviewService } from './overview.service.js';

/**
 * Overview dashboard: read-only aggregates over the tickets tables, the CDR (via the shared PbxCallsModule) and the AI
 * call analysis (CallAnalysisService.stats, aggregates only).
 * Owns no tables.
 */
@Module({
  imports: [PbxCallsModule, CallAnalysisModule, CdrModule, RecordingsModule, TicketsModule],
  controllers: [OverviewController],
  providers: [OverviewService, OverviewRepository],
})
export class OverviewModule {}
