import { Module } from '@nestjs/common';
import { PbxCallsModule } from '../../pbx/calls/pbx-calls.module.js';
import { RecordingsModule } from '../recordings/recordings.module.js';
import { CallAnalysisQueueService } from './call-analysis-queue.service.js';
import { CallAnalysisWorkerController } from './call-analysis-worker.controller.js';
import { CallAnalysisController } from './call-analysis.controller.js';
import { CallAnalysisEnqueuer } from './call-analysis.enqueuer.js';
import { CallAnalysisRepository } from './call-analysis.repository.js';
import { CallAnalysisService } from './call-analysis.service.js';
import { WorkerTokenGuard } from './worker-token.guard.js';

/** AI analysis of call recordings: job queue for the external worker, transcripts, rubric results, aggregates. */
@Module({
  imports: [PbxCallsModule, RecordingsModule],
  controllers: [CallAnalysisController, CallAnalysisWorkerController],
  providers: [
    CallAnalysisRepository,
    CallAnalysisService,
    CallAnalysisQueueService,
    CallAnalysisEnqueuer,
    WorkerTokenGuard,
  ],
  // The overview dashboard reuses the aggregates (same numbers and prompt-version rule as the «Tahlil» page).
  exports: [CallAnalysisService],
})
export class CallAnalysisModule {}
