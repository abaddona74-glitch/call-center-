import {
  BUSINESS_TIMEZONE,
  type OverviewCalls,
  type OverviewCallsQuery,
  type OverviewQuality,
  type OverviewQualityQuery,
  type OverviewTickets,
  type OverviewTicketsQuery,
} from '@cc/shared';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { datesBetween } from '../../common/time/business-time.js';
import { AppConfig } from '../../config/app-config.js';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import { CallAnalysisService } from '../call-analysis/call-analysis.service.js';
import { dailySeries, hourlySeries, summarize } from '../stats/domain/metrics.js';
import { buildOverviewQuality } from './domain/quality-overview.js';
import { buildOverviewTickets, regionFilterOf } from './domain/ticket-overview.js';
import { OverviewRepository } from './overview.repository.js';

/** Same limit as the ticket reports. */
const MAX_TICKET_DAYS = 366;

/**
 * The overview dashboard (observers, superuser). Read-only aggregates:
 *  - tickets: the tickets module's tables and SLA rules (domain/ticket-overview.ts);
 *  - calls: the CDR through the shared PbxCallsService and the statistics page's metric functions
 *    (stats/domain/metrics.ts), so every number equals /api/stats for the same period and scope;
 *  - call quality: CallAnalysisService.stats for the current prompt version (= the «Tahlil» page), totals only.
 */
@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  constructor(
    private readonly repo: OverviewRepository,
    private readonly pbxCalls: PbxCallsService,
    private readonly config: AppConfig,
    private readonly analysis: CallAnalysisService,
  ) {}

  async tickets(q: OverviewTicketsQuery, now = new Date()): Promise<OverviewTickets> {
    const from = DateTime.fromISO(q.from, { zone: BUSINESS_TIMEZONE }).startOf('day');
    const to = DateTime.fromISO(q.to, { zone: BUSINESS_TIMEZONE }).startOf('day').plus({ days: 1 });
    if (!from.isValid || !to.isValid) throw new BadRequestException('Invalid date');
    if (to.diff(from, 'days').days > MAX_TICKET_DAYS)
      throw new BadRequestException(`Date range is limited to ${MAX_TICKET_DAYS} days`);

    const [fromDate, toDate] = [from.toJSDate(), to.toJSDate()];
    const [cohort, open, takers, regions, executives] = await Promise.all([
      this.repo.createdBetween(fromDate, toDate),
      this.repo.notClosed(),
      this.repo.takersOfCreatedBetween(fromDate, toDate),
      this.repo.regions(),
      this.repo.executives(),
    ]);
    const region = regionFilterOf(q.region, regions);
    if (!region.ok) throw new BadRequestException('Unknown region');

    return {
      range: { from: q.from, to: q.to },
      region: q.region ?? null,
      generatedAt: now.toISOString(),
      slaWorkingDays: this.config.get('TICKETS_SLA_WORKING_DAYS'),
      callbackSlaWorkingDays: this.config.get('TICKETS_CALLBACK_SLA_WORKING_DAYS'),
      ...buildOverviewTickets({ cohort, open, takers, regions, executives, region: region.filter, now }),
    };
  }

  async calls(q: OverviewCallsQuery): Promise<OverviewCalls> {
    this.pbxCalls.assertRange(q.from, q.to, this.pbxCalls.maxStatsDays);
    const calls = await this.pbxCalls.callsForRange(q.from, q.to);
    const hours =
      q.scope === 'working' ? this.pbxCalls.calendar.workingHours() : Array.from({ length: 24 }, (_, h) => h);
    return {
      summary: summarize(calls, { from: q.from, to: q.to, scope: q.scope }),
      hourly: hourlySeries(calls, q.scope, hours),
      daily: dailySeries(calls, q.scope, datesBetween(q.from, q.to), (d) => this.pbxCalls.calendar.isWorkingDay(d)),
    };
  }

  async quality(q: OverviewQualityQuery): Promise<OverviewQuality> {
    // Current prompt version only (the service's default): scores of different versions are never mixed.
    const stats = await this.analysis.stats({ from: q.from, to: q.to });
    return buildOverviewQuality(stats, await this.answeredCalls(q));
  }

  /** Answered inbound + connected outbound calls of the period, any hour; null while the PBX is unavailable. */
  private async answeredCalls(q: OverviewQualityQuery): Promise<number | null> {
    if (!this.pbxCalls.enabled) return null;
    try {
      const s = summarize(await this.pbxCalls.callsForRange(q.from, q.to), { from: q.from, to: q.to, scope: 'all' });
      return s.inbound.answered + s.outbound.connected;
    } catch (err) {
      this.logger.warn(`answered calls unavailable for the quality block: ${(err as Error).message}`);
      return null;
    }
  }
}
