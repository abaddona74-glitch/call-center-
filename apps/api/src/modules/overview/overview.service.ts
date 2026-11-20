import {
  BUSINESS_TIMEZONE,
  type CallAnalysisDetails,
  type CallDetailsResponse,
  type CallHistoryResponse,
  type CallRecording,
  type OverviewCallListQuery,
  type OverviewCalls,
  type OverviewCallsQuery,
  type OverviewQuality,
  type OverviewQualityListQuery,
  type OverviewQualityQuery,
  type OverviewTicketList,
  type OverviewTicketListQuery,
  type OverviewTickets,
  type OverviewTicketsQuery,
  type SessionUser,
  type TicketDetail,
} from '@cc/shared';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { datesBetween, wallToIso } from '../../common/time/business-time.js';
import { AppConfig } from '../../config/app-config.js';
import type { AssembledCall } from '../../pbx/calls/call-assembler.js';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import { CallAnalysisService } from '../call-analysis/call-analysis.service.js';
import { CdrService } from '../cdr/cdr.service.js';
import { matchesSearch, paginate, parseSearch, toCallListItem } from '../cdr/domain/call-filter.js';
import { RecordingsService } from '../recordings/recordings.service.js';
import { dailySeries, hourlySeries, inScope, summarize } from '../stats/domain/metrics.js';
import { TicketRecordingsService } from '../tickets/ticket-recordings.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { analysedCallFallback, matchesCallMetric, matchesQualityMetric } from './domain/call-list.js';
import { buildOverviewQuality } from './domain/quality-overview.js';
import {
  matchesTicketMetric,
  matchesTicketSearch,
  ticketListOrder,
  ticketMetricSource,
  toTicketListItem,
} from './domain/ticket-list.js';
import { buildOverviewTickets, regionFilterOf } from './domain/ticket-overview.js';
import { OverviewRepository } from './overview.repository.js';

/** Same limit as the ticket reports. */
const MAX_TICKET_DAYS = 366;

/**
 * The overview dashboard (observers, superuser). Read-only:
 *  - tickets: the tickets module's tables and SLA rules (domain/ticket-overview.ts);
 *  - calls: the CDR through the shared PbxCallsService and the statistics page's metric functions
 *    (stats/domain/metrics.ts), so every number equals /api/stats for the same period and scope;
 *  - call quality: CallAnalysisService.stats for the current prompt version (= the «Tahlil» page), totals only;
 *  - details (owner, 19.11.2026): the records behind each number (same rules, so a list adds up to its number) and
 *    read-only cards — a ticket (tickets module, `overview` scope), a call (CDR), its analysis and its recording
 *    (RecordingsService, audited like every recording play).
 */
@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  constructor(
    private readonly repo: OverviewRepository,
    private readonly pbxCalls: PbxCallsService,
    private readonly config: AppConfig,
    private readonly analysis: CallAnalysisService,
    private readonly cdr: CdrService,
    private readonly recordings: RecordingsService,
    private readonly ticketsModule: TicketsService,
    private readonly ticketRecordings: TicketRecordingsService,
  ) {}

  /** [start, end) of the period in Asia/Tashkent. */
  private period(q: { from: string; to: string }): [Date, Date] {
    const from = DateTime.fromISO(q.from, { zone: BUSINESS_TIMEZONE }).startOf('day');
    const to = DateTime.fromISO(q.to, { zone: BUSINESS_TIMEZONE }).startOf('day').plus({ days: 1 });
    if (!from.isValid || !to.isValid) throw new BadRequestException('Invalid date');
    if (to.diff(from, 'days').days > MAX_TICKET_DAYS)
      throw new BadRequestException(`Date range is limited to ${MAX_TICKET_DAYS} days`);
    return [from.toJSDate(), to.toJSDate()];
  }

  async tickets(q: OverviewTicketsQuery, now = new Date()): Promise<OverviewTickets> {
    const [fromDate, toDate] = this.period(q);
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

  /** The tickets behind one ticket number (same filters as the number: period, region, Mas'ul). */
  async ticketList(q: OverviewTicketListQuery, now = new Date()): Promise<OverviewTicketList> {
    const [fromDate, toDate] = this.period(q);
    const fromNow = ticketMetricSource(q.metric) === 'now';
    const [rows, takers, regions] = await Promise.all([
      fromNow ? this.repo.notClosed() : this.repo.createdBetween(fromDate, toDate),
      fromNow ? Promise.resolve(new Map<number, number[]>()) : this.repo.takersOfCreatedBetween(fromDate, toDate),
      this.repo.regions(),
    ]);
    const region = regionFilterOf(q.region, regions);
    if (!region.ok) throw new BadRequestException('Unknown region');
    const regionsById = new Map(regions.map((r) => [r.id, r]));
    const ctx = { now, takers, status: q.status, executive: q.executive };
    const items = rows
      .filter(
        (t) => (region.filter === undefined || t.regionId === region.filter) && matchesTicketMetric(t, q.metric, ctx),
      )
      .sort(ticketListOrder(q.metric, now))
      .map((t) => toTicketListItem(t, regionsById, now))
      .filter((item) => matchesTicketSearch(item, q.search));
    return {
      items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      page: q.page,
      pageSize: q.pageSize,
      total: items.length,
    };
  }

  /** Read-only ticket card: any ticket, no actions (the tickets module's `overview` scope). */
  ticketDetail(user: SessionUser, id: number): Promise<TicketDetail> {
    return this.ticketsModule.overviewDetail(user, id);
  }

  ticketAttachment(user: SessionUser, ticketId: number, attachmentId: number) {
    return this.ticketsModule.attachment(user, ticketId, attachmentId, 'overview');
  }

  ticketDocPreview(user: SessionUser, ticketId: number, attachmentId: number) {
    return this.ticketsModule.docPreview(user, ticketId, attachmentId, 'overview');
  }

  /** Recording of a ticket's call (audited by the tickets module, like its own endpoint). */
  ticketRecording(
    user: SessionUser,
    ticketId: number,
    callRowId: number,
    range: string | undefined,
    download: boolean,
  ) {
    return this.ticketRecordings.stream(user, ticketId, callRowId, range, download, 'overview');
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

  /** The calls behind one call number (same period and scope as the summary). */
  async callList(q: OverviewCallListQuery): Promise<CallHistoryResponse> {
    this.pbxCalls.assertRange(q.from, q.to, this.pbxCalls.maxStatsDays);
    const [calls, names] = await Promise.all([
      this.pbxCalls.callsForRange(q.from, q.to),
      this.pbxCalls.operatorNames(),
    ]);
    const search = parseSearch(q.search, this.pbxCalls.dialplan);
    const matching = calls.filter(
      (c) => inScope(c, q.scope) && matchesCallMetric(c, q.metric) && matchesSearch(c, search, names),
    );
    const page = paginate(matching, q.page, q.pageSize);
    return {
      // Like the history for whoever lacks `recordings.listen`: whether there is a recording, not its file name.
      items: page.items.map((c) => toCallListItem(c, names, { includeRecording: false, toIso: wallToIso })),
      page: q.page,
      pageSize: q.pageSize,
      total: page.total,
      range: { from: q.from, to: q.to, allDays: false },
    };
  }

  async quality(q: OverviewQualityQuery): Promise<OverviewQuality> {
    // Current prompt version only (the service's default): scores of different versions are never mixed.
    const stats = await this.analysis.stats({ from: q.from, to: q.to });
    return buildOverviewQuality(stats, await this.answeredCalls(q));
  }

  /** The analysed calls (current prompt version) behind one quality number. */
  async qualityList(q: OverviewQualityListQuery): Promise<CallHistoryResponse> {
    const facts = (await this.analysis.analysesForPeriod(q.from, q.to)).filter((a) => matchesQualityMetric(a, q));
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
        this.logger.warn(`CDR unavailable for the quality list: ${(err as Error).message}`);
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
      .filter((r) =>
        !q.search
          ? true
          : r.call
            ? matchesSearch(r.call, search, names)
            : r.id.includes(q.search) || r.item?.operator?.ext === q.search,
      );
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

  /** Call card: the CDR view (the observer sees whether there is a recording, not its file name). */
  callDetails(id: string, user: SessionUser): Promise<CallDetailsResponse> {
    return this.cdr.details(id, user);
  }

  callAnalysis(id: string): Promise<CallAnalysisDetails> {
    return this.analysis.details(id);
  }

  /** The call's recording (exact lookup by the call id); playing it is audited by the controller. */
  callRecording(id: string): Promise<CallRecording> {
    return this.recordings.forCallTrusted(id);
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
