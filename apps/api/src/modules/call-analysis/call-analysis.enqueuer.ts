import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { epochToWall } from '../../common/time/business-time.js';
import { AppConfig } from '../../config/app-config.js';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import { CallAnalysisQueueService } from './call-analysis-queue.service.js';

/**
 * CALL_ANALYSIS_ENABLED: every CALL_ANALYSIS_ENQUEUE_INTERVAL_SEC, queue the analysable calls that started in the
 * last CALL_ANALYSIS_LOOKBACK_HOURS (already queued ones are skipped by the primary key). Older periods: backfill.
 */
@Injectable()
export class CallAnalysisEnqueuer implements OnApplicationBootstrap {
  private readonly logger = new Logger(CallAnalysisEnqueuer.name);
  private running = false;

  constructor(
    private readonly calls: PbxCallsService,
    private readonly queue: CallAnalysisQueueService,
    private readonly config: AppConfig,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('CALL_ANALYSIS_ENABLED') || !this.calls.enabled) {
      this.logger.log('automatic call analysis queueing is off');
      return;
    }
    const tick = () =>
      void this.tick().catch((err: unknown) => this.logger.warn(`enqueue failed: ${(err as Error).message}`));
    this.scheduler.addInterval(
      'call-analysis-enqueue',
      setInterval(tick, this.config.get('CALL_ANALYSIS_ENQUEUE_INTERVAL_SEC') * 1000),
    );
  }

  /** One run; null while the previous one is still running. */
  async tick(now = Date.now()): Promise<{ eligible: number; enqueued: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const sinceMs = now - this.config.get('CALL_ANALYSIS_LOOKBACK_HOURS') * 3_600_000;
      const zone = this.calls.calendar.timezone;
      const fromDate = epochToWall(sinceMs, zone).slice(0, 10);
      const toDate = epochToWall(now, zone).slice(0, 10);
      const calls = (await this.calls.callsForRange(fromDate, toDate)).filter((c) => c.startEpochMs >= sinceMs);
      const result = await this.queue.enqueueCalls(calls, 'auto');
      if (result.enqueued) this.logger.log(`queued ${result.enqueued} call(s) for analysis`);
      return result;
    } finally {
      this.running = false;
    }
  }
}
