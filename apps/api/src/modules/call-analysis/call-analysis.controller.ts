import {
  CDR_ACCESS,
  type CallAnalysisBackfillRequest,
  CallAnalysisBackfillRequestSchema,
  type CallAnalysisBackfillResponse,
  CallAnalysisBackfillResponseSchema,
  type CallAnalysisDetails,
  CallAnalysisDetailsSchema,
  type CallAnalysisQueue,
  CallAnalysisQueueSchema,
  type CallAnalysisRetryResponse,
  CallAnalysisRetryResponseSchema,
  type CallAnalysisStats,
  type CallAnalysisStatsQuery,
  CallAnalysisStatsQuerySchema,
  CallAnalysisStatsSchema,
  type CallAnalysisStatusQuery,
  CallAnalysisStatusQuerySchema,
  type CallAnalysisStatusResponse,
  CallAnalysisStatusResponseSchema,
  type CallTopicList,
  CallTopicListSchema,
  CdrCallIdSchema,
} from '@cc/shared';
import { Body, Controller, Get, HttpCode, Param, Post, Query, SerializeOptions } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { CallAnalysisQueueService } from './call-analysis-queue.service.js';
import { CallAnalysisService } from './call-analysis.service.js';

/**
 * AI call analysis for users. Access (CDR_ACCESS in @cc/shared): one call — the right to play its recording;
 * aggregates — the statistics page right; the queue — `analysis.manage` (superuser).
 */
@Controller('call-analysis')
export class CallAnalysisController {
  constructor(
    private readonly analysis: CallAnalysisService,
    private readonly queue: CallAnalysisQueueService,
  ) {}

  @Get('calls/:callId')
  @RequirePermission(CDR_ACCESS['analysis.call'])
  @SerializeOptions({ schema: CallAnalysisDetailsSchema })
  details(@Param('callId', { schema: CdrCallIdSchema }) callId: string): Promise<CallAnalysisDetails> {
    return this.analysis.details(callId);
  }

  @Get('status')
  @RequirePermission(CDR_ACCESS['analysis.call'])
  @SerializeOptions({ schema: CallAnalysisStatusResponseSchema })
  status(@Query({ schema: CallAnalysisStatusQuerySchema }) q: CallAnalysisStatusQuery): Promise<CallAnalysisStatusResponse> {
    return this.analysis.status(q.ids);
  }

  @Get('stats')
  @RequirePermission(CDR_ACCESS['analysis.stats'])
  @SerializeOptions({ schema: CallAnalysisStatsSchema })
  stats(@Query({ schema: CallAnalysisStatsQuerySchema }) q: CallAnalysisStatsQuery): Promise<CallAnalysisStats> {
    return this.analysis.stats(q);
  }

  @Get('topics')
  @RequirePermission(CDR_ACCESS['analysis.stats'])
  @SerializeOptions({ schema: CallTopicListSchema })
  topics(): Promise<CallTopicList> {
    return this.analysis.topics();
  }

  @Get('queue')
  @RequirePermission(CDR_ACCESS['analysis.manage'])
  @SerializeOptions({ schema: CallAnalysisQueueSchema })
  progress(): Promise<CallAnalysisQueue> {
    return this.queue.progress();
  }

  @Post('backfill')
  @HttpCode(200)
  @RequirePermission(CDR_ACCESS['analysis.manage'])
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeOptions({ schema: CallAnalysisBackfillResponseSchema })
  backfill(
    @Body({ schema: CallAnalysisBackfillRequestSchema }) body: CallAnalysisBackfillRequest,
  ): Promise<CallAnalysisBackfillResponse> {
    return this.queue.backfill(body);
  }

  @Post('queue/retry-failed')
  @HttpCode(200)
  @RequirePermission(CDR_ACCESS['analysis.manage'])
  @SerializeOptions({ schema: CallAnalysisRetryResponseSchema })
  retryFailed(): Promise<CallAnalysisRetryResponse> {
    return this.queue.retryFailed();
  }
}
