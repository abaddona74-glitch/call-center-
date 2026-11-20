import {
  BUSINESS_TIMEZONE,
  CALL_ANALYSIS_PROMPT_VERSION,
  type CallHistoryResponse,
  KPI_NO_REGION,
  type KpiExecutiveTicketListQuery,
  type KpiExecutivesQuery,
  type KpiExecutivesResponse,
  type KpiOperatorCallListQuery,
  type KpiOperatorTicketListQuery,
  type KpiOperatorsQuery,
  type KpiOperatorsResponse,
  type OverviewTicketList,
} from '@cc/shared';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { daysInRange, wallToIso } from '../../common/time/business-time.js';
import { AppConfig } from '../../config/app-config.js';
import type { AssembledCall } from '../../pbx/calls/call-assembler.js';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import type { SurveyRating } from '../../pbx/calls/survey-rating.js';
import { CallAnalysisService } from '../call-analysis/call-analysis.service.js';
import { aggregateAnalyses } from '../call-analysis/domain/aggregate.js';
import { matchesSearch, paginate, parseSearch, toCallListItem } from '../cdr/domain/call-filter.js';
import { ExcludedOperatorsService } from '../excluded-operators/excluded-operators.service.js';
import { analysedCallFallback, matchesQualityMetric } from '../overview/domain/call-list.js';
import { matchesTicketSearch, toTicketListItem } from '../overview/domain/ticket-list.js';
import type { OverviewTicketFact } from '../overview/domain/ticket-overview.js';
import { periodWindow, summarizePresence, workingWindows } from '../operator-presence/domain/presence-summary.js';
import { OperatorPresenceService } from '../operator-presence/operator-presence.service.js';
import { summarize, surveyByOperator } from '../stats/domain/metrics.js';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service.js';
import {
  type ExecutiveKpiInput,
  type RegionKey,
  buildExecutiveKpi,
  executiveTicketIds,
} from './domain/executive-kpi.js';
import {
  buildOperatorKpi,
  matchesOperatorCall,
  operatorTicketIds,
  qualityByOperator,
  ratedCallScores,
  talkWhileOnline,
  ticketsByOperator,
} from './domain/operator-kpi.js';
import { KpiRepository } from './kpi.repository.js';

/** Same limit as the ticket reports and the overview dashboard. */
const MAX_TICKET_DAYS = 366;

/**
 * «KPI xodimlar» (owner, 19.11.2026; docs/rewrite/METRICS.md §11). Read-only joins of what other modules already
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
    const { input } = await this.executiveInput(q, now);
    return {
      range: { from: q.from, to: q.to },
      generatedAt: now.toISOString(),
      slaWorkingDays: this.config.get('TICKETS_SLA_WORKING_DAYS'),
      executives: buildExecutiveKpi(input),
    };
  }

  // --- the records behind each number (owner, 19.11.2026; METRICS.md §11.4) ----------------------------------------

  /** The calls behind one operator's call number: the same rules as the number, the overview dashboard's list shape. */
  async operatorCalls(q: KpiOperatorCallListQuery): Promise<CallHistoryResponse> {
    this.pbxCalls.assertRange(q.from, q.to, this.pbxCalls.maxStatsDays);
    const metric = q.metric;
    if (metric === 'analysed' || metric === 'flagged' || metric === 'handled') return this.analysedCalls(q);
    const [calls, names, ratings] = await Promise.all([
      this.pbxCalls.callsForRange(q.from, q.to),
      this.pbxCalls.operatorNames(),
      metric === 'rated' ? this.pbxCalls.surveyRatingsForRange(q.from, q.to) : Promise.resolve(null),
    ]);
    const search = parseSearch(q.search, this.pbxCalls.dialplan);
    const rated = metric === 'rated' ? ratedCallScores(ratings ?? [], calls, q.scope, q.ext) : null;
    const matching = calls.filter(
      (c) =>
        (rated ? rated.has(c.id) : metric !== 'rated' && matchesOperatorCall(c, q.ext, metric, q.scope)) &&
        matchesSearch(c, search, names),
    );
    const page = paginate(matching, q.page, q.pageSize);
    return {
      // Like the overview lists: whether there is a recording, not its file name.
      items: page.items.map((c) => {
        const item = toCallListItem(c, names, { includeRecording: false, toIso: wallToIso });
        const score = rated?.get(c.id);
        return score === undefined ? item : { ...item, clientRating: score };
      }),
      page: q.page,
      pageSize: q.pageSize,
      total: page.total,
      range: { from: q.from, to: q.to, allDays: false },
    };
  }

  /** One operator's analysed calls (current prompt version): all of them, those with a red flag, or the handled ones. */
  private async analysedCalls(q: KpiOperatorCallListQuery): Promise<CallHistoryResponse> {
    const metric = q.metric === 'analysed' ? 'analyzed' : q.metric === 'flagged' ? 'flagged' : 'handled';
    const facts = (await this.analysis.analysesForPeriod(q.from, q.to)).filter(
      (a) => a.operatorExt === q.ext && matchesQualityMetric(a, { metric }),
    );
    let byId = new Map<string, AssembledCall>();
    let names: ReadonlyMap<string, string> = new Map();
    if (this.pbxCalls.enabled) {
      try {
        const [calls, n] = await Promise.all([
          this.pbxCalls.callsForRange(q.from, q.to),
          this.pbxCalls.operatorNames(),
        ]);
        byId = new Map(calls.map((c) => [c.id, c]));
        names = n;
      } catch (err) {
        this.logger.warn(`CDR unavailable for the KPI quality list: ${(err as Error).message}`);
      }
    }
    const search = parseSearch(q.search, this.pbxCalls.dialplan);
    const rows = facts
      .map((a) => {
        const call = byId.get(a.callId);
        return call
          ? { id: a.callId, startEpochMs: call.startEpochMs, call, item: null }
          : { id: a.callId, startEpochMs: Date.parse(a.startedAt), call: null, item: analysedCallFallback(a) };
      })
      .filter((r) => !q.search || (r.call ? matchesSearch(r.call, search, names) : r.id.includes(q.search)));
    const page = paginate(rows, q.page, q.pageSize);
    return {
      items: page.items.map(
        (r) => r.item ?? toCallListItem(r.call as AssembledCall, names, { includeRecording: false, toIso: wallToIso }),
      ),
      page: q.page,
      pageSize: q.pageSize,
      total: page.total,
      range: { from: q.from, to: q.to, allDays: false },
    };
  }

  /** The tickets behind one operator's ticket number (created / called back / closed / closed late). */
  async operatorTickets(q: KpiOperatorTicketListQuery, now = new Date()): Promise<OverviewTicketList> {
    const [from, to] = this.ticketPeriod(q);
    const [tickets, attempts] = await Promise.all([
      this.repo.operatorTickets(from, to),
      this.repo.callbackAttempts(from, to),
    ]);
    const ids = operatorTicketIds(tickets, attempts, [from, to]).get(q.ext)?.[q.metric] ?? new Set<number>();
    return this.ticketList([...ids], q, now);
  }

  /** The tickets behind one Mas'ul number — the whole row or one region (`region`: code or "none"). */
  async executiveTickets(q: KpiExecutiveTicketListQuery, now = new Date()): Promise<OverviewTicketList> {
    const { input, regions } = await this.executiveInput(q, now);
    let region: RegionKey | undefined;
    if (q.region === KPI_NO_REGION) region = 'none';
    else if (q.region !== undefined) {
      const found = regions.find((r) => r.code === q.region);
      if (!found) throw new BadRequestException('Unknown region');
      region = found.id;
    }
    return this.ticketList([...executiveTicketIds(input, q.user, region, q.metric)], q, now);
  }

  // --- internals ----------------------------------------------------------------------------------------------------

  /** [start, end) of the period for ticket figures (at most MAX_TICKET_DAYS). */
  private ticketPeriod(q: { from: string; to: string }): [Date, Date] {
    if (daysInRange(q.from, q.to) > MAX_TICKET_DAYS)
      throw new BadRequestException(`Date range is limited to ${MAX_TICKET_DAYS} days`);
    const period = periodWindow(q.from, q.to, BUSINESS_TIMEZONE);
    return [new Date(period[0]), new Date(period[1])];
  }

  private async executiveInput(q: { from: string; to: string }, now: Date) {
    const [from, to] = this.ticketPeriod(q);
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
    const input: ExecutiveKpiInput = {
      events,
      tickets,
      holding,
      regions,
      executives,
      names: await this.repo.usernames(actorIds),
      period: [from, to],
      now,
    };
    return { input, regions };
  }

  /** Ticket ids → one page of the overview dashboard's ticket list (newest first, searchable). */
  private async ticketList(
    ids: number[],
    q: { page: number; pageSize: number; search?: string },
    now: Date,
  ): Promise<OverviewTicketList> {
    const [facts, regions] = await Promise.all([this.repo.ticketFacts(ids), this.repo.regions()]);
    const regionsById = new Map(regions.map((r) => [r.id, r]));
    const items = [...facts]
      .sort(
        (a: OverviewTicketFact, b: OverviewTicketFact) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
      )
      .map((t) => toTicketListItem(t, regionsById, now))
      .filter((item) => matchesTicketSearch(item, q.search));
    return {
      items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      page: q.page,
      pageSize: q.pageSize,
      total: items.length,
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
