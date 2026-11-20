import { Module } from '@nestjs/common';
import { PbxCallsModule } from '../../pbx/calls/pbx-calls.module.js';
import { CallAnalysisModule } from '../call-analysis/call-analysis.module.js';
import { OperatorPresenceModule } from '../operator-presence/operator-presence.module.js';
import { KpiController } from './kpi.controller.js';
import { KpiRepository } from './kpi.repository.js';
import { KpiService } from './kpi.service.js';

/**
 * Staff KPI page «KPI xodimlar» (permission `kpi.view`): read-only joins of the CDR (PbxCallsModule + the statistics
 * functions), the AI call analysis, the tickets tables and the presence log. Owns no tables.
 */
@Module({
  imports: [PbxCallsModule, CallAnalysisModule, OperatorPresenceModule],
  controllers: [KpiController],
  providers: [KpiService, KpiRepository],
})
export class KpiModule {}
