import {
  BUSINESS_TIMEZONE,
  CALL_ANALYSIS_PROMPT_VERSION,
  type KpiExecutivesQuery,
  type KpiExecutivesResponse,
  type KpiOperatorsQuery,
  type KpiOperatorsResponse,
} from '@cc/shared';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { daysInRange } from '../../common/time/business-time.js';
import { AppConfig } from '../../config/app-config.js';
import type { AssembledCall } from '../../pbx/calls/call-assembler.js';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import type { SurveyRating } from '../../pbx/calls/survey-rating.js';
import { CallAnalysisService } from '../call-analysis/call-analysis.service.js';
import { aggregateAnalyses } from '../call-analysis/domain/aggregate.js';
import { ExcludedOperatorsService } from '../excluded-operators/excluded-operators.service.js';
import { periodWindow, summarizePresence, workingWindows } from '../operator-presence/domain/presence-summary.js';
import { OperatorPresenceService } from '../operator-presence/operator-presence.service.js';
import { summarize, surveyByOperator } from '../stats/domain/metrics.js';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service.js';
import { buildExecutiveKpi } from './domain/executive-kpi.js';
import { buildOperatorKpi, qualityByOperator, talkWhileOnline, ticketsByOperator } from './domain/operator-kpi.js';
import { KpiRepository } from './kpi.repository.js';

/** Same limit as the ticket reports and the overview dashboard. */
const MAX_TICKET_DAYS = 366;

/**
 * «KPI xodimlar» (owner, 19.11.2026; docs/rewrite/METRICS.md §10). Read-only joins of what other modules already
 * compute, so each number equals its home page:
 *  - calls and client ratings: the CDR through PbxCallsService and the statistics page's functions (= /api/stats);
 *  - AI quality: the «Tahlil» aggregates over the current prompt version (CallAnalysisService + aggregateAnalyses);
 *  - tickets and callbacks, executives: the tickets module's tables and events (read-only queries here);
 *  - online / pause time: the presence log (OperatorPresenceService).
 */
@Injectable()
export class KpiService {
  private readonly logger = new Logger(KpiService.name);

  constructor(
    private readonly repo: KpiRepository,
    private readonly pbxCalls: PbxCallsService,
    private readonly analysis: CallAnalysisService,
    private readonly presence: OperatorPresenceService,
    private readonly excluded: ExcludedOperatorsService,
    private readonly calendar: WorkingCalendarService,
    private readonly config: AppConfig,
  ) {}

  async operators(q: KpiOperatorsQuery, now = new Date()): Promise<KpiOperatorsResponse> {
    this.pbxCalls.assertRange(q.from, q.to, this.pbxCalls.maxStatsDays);
    const period = periodWindow(q.from, q.to, BUSINESS_TIMEZONE);
    const [from, to] = [new Date(period[0]), new Date(period[1])];

    const [pbx, tickets, attempts, analyses, presence] = await Promise.all([
      this.pbxData(q),
      this.repo.operatorTickets(from, to),
      this.repo.callbackAttempts(from, to),
      this.analysis.analysesForPeriod(q.from, q.to),
      this.presence.history(from, to),
    ]);
    const names = pbx ? pbx.names : await this.repo.usernamesByExtension();

    const cal = this.calendar.get();
    const info = cal.info();
    const windows =
      q.scope === 'working'
        ? workingWindows(q.from, q.to, {
            timezone: cal.timezone,
            isWorkingDay: (d) => cal.isWorkingDay(d),
            start: info.start,
            end: info.end,
          })
        : undefined;
    const presenceTotals = summarizePresence(presence.intervals, { period, now: now.getTime(), windows });
    const since = presence.since?.getTime() ?? null;

    // Analysed calls of the current prompt version, aggregated like the «Tahlil» page (tickets are irrelevant here).
    const quality = aggregateAnalyses(
      analyses.map((a) => ({ ...a, hasTicket: false })),
      { names: new Map(), problemsLimit: 0, flaggedLimit: 0 },
    );
    const answered = pbx ? summarize(pbx.calls, { from: q.from, to: q.to, scope: 'all' }) : null;

    return {
      range: { from: q.from, to: q.to, scope: q.scope },
      generatedAt: now.toISOString(),
      callsAvailable: pbx !== null,
      surveyAvailable: pbx !== null && pbx.ratings !== null,
      quality: {
        promptVersion: CALL_ANALYSIS_PROMPT_VERSION,
        analysed: quality.totals.analyzed,
        answeredCalls: answered ? answered.inbound.answered + answered.outbound.connected : null,
        days: [
          ...new Set(
            analyses.map((a) => DateTime.fromISO(a.startedAt, { zone: BUSINESS_TIMEZONE }).toISODate() as string),
          ),
        ].sort(),
      },
      presence: {
        since: presence.since?.toISOString() ?? null,
        partial: since === null || since > period[0],
      },
      operators: buildOperatorKpi({
        calls: pbx?.calls ?? null,
        scope: q.scope,
        names,
        groupOf: (ext) => this.pbxCalls.groupOf(ext),
        excluded: this.excluded.extensions(),
        survey: pbx?.ratings ? surveyByOperator(pbx.ratings, pbx.calls, q.scope) : undefined,
        tickets: ticketsByOperator(tickets, attempts, [from, to]),
        quality: qualityByOperator(quality.operators),
        presence: presenceTotals,
        talkForShare: pbx ? talkWhileOnline(pbx.calls, q.scope, presence.intervals, now.getTime()) : new Map(),
      }),
    };
  }

  async executives(q: KpiExecutivesQuery, now = new Date()): Promise<KpiExecutivesResponse> {
    if (daysInRange(q.from, q.to) > MAX_TICKET_DAYS)
      throw new BadRequestException(`Date range is limited to ${MAX_TICKET_DAYS} days`);
    const period = periodWindow(q.from, q.to, BUSINESS_TIMEZONE);
    const [from, to] = [new Date(period[0]), new Date(period[1])];
    const [{ events, tickets }, holding, regions, executives] = await Promise.all([
      this.repo.regionEvents(from, to),
      this.repo.holding(),
      this.repo.regions(),
      this.repo.executives(),
    ]);
    const actorIds = [
      ...new Set([
        ...events.map((e) => e.actorUserId).filter((id): id is number => id !== null),
        ...holding.map((h) => h.assigneeUserId),
      ]),
    ];
    return {
      range: { from: q.from, to: q.to },
      generatedAt: now.toISOString(),
      slaWorkingDays: this.config.get('TICKETS_SLA_WORKING_DAYS'),
      executives: buildExecutiveKpi({
        events,
        tickets,
        holding,
        regions,
        executives,
        names: await this.repo.usernames(actorIds),
        period: [from, to],
        now,
      }),
    };
  }

  /** Calls, names and ratings from the PBX; null while it is not configured or unreachable (the rest still shows). */
  private async pbxData(q: KpiOperatorsQuery): Promise<{
    calls: AssembledCall[];
    names: Map<string, string>;
    ratings: SurveyRating[] | null;
  } | null> {
    if (!this.pbxCalls.enabled) return null;
    try {
      const [calls, names, ratings] = await Promise.all([
        this.pbxCalls.callsForRange(q.from, q.to),
        this.pbxCalls.operatorNames(),
        this.pbxCalls.surveyRatingsForRange(q.from, q.to),
      ]);
      return { calls, names, ratings };
    } catch (err) {
      this.logger.warn(`PBX unavailable for the KPI page: ${(err as Error).message}`);
      return null;
    }
  }
}
