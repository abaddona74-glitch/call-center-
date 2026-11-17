import type {
  OperatorStatsQuery,
  OperatorStatsResponse,
  StatsQuery,
  StatsSeriesResponse,
  StatsSummary,
  TopClientsQuery,
  TopClientsResponse,
  WorkingCalendarInfo,
} from '@cc/shared';
import { Injectable } from '@nestjs/common';
import { datesBetween, wallToIso } from '../../common/time/business-time.js';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import { dailySeries, hourlySeries, operatorStats, summarize, topClients } from './domain/metrics.js';

@Injectable()
export class StatsService {
  constructor(private readonly calls: PbxCallsService) {}

  private async load(q: { from: string; to: string }) {
    this.calls.assertRange(q.from, q.to, this.calls.maxStatsDays);
    return this.calls.callsForRange(q.from, q.to);
  }

  calendar(): WorkingCalendarInfo {
    return this.calls.calendar.info();
  }

  async summary(q: StatsQuery): Promise<StatsSummary> {
    return summarize(await this.load(q), { from: q.from, to: q.to, scope: q.scope });
  }

  async series(q: StatsQuery): Promise<StatsSeriesResponse> {
    const calls = await this.load(q);
    const hours = q.scope === 'working' ? this.calls.calendar.workingHours() : Array.from({ length: 24 }, (_, h) => h);
    return {
      range: { from: q.from, to: q.to, scope: q.scope },
      hourly: hourlySeries(calls, q.scope, hours),
      daily: dailySeries(calls, q.scope, datesBetween(q.from, q.to), (d) => this.calls.calendar.isWorkingDay(d)),
    };
  }

  async operators(q: OperatorStatsQuery): Promise<OperatorStatsResponse> {
    const [calls, names] = await Promise.all([this.load(q), this.calls.operatorNames()]);
    return {
      range: { from: q.from, to: q.to, scope: q.scope },
      operators: operatorStats(calls, {
        scope: q.scope,
        names,
        groupOf: (ext) => this.calls.groupOf(ext),
        knownExtensions: names.keys(),
        group: q.group,
      }),
      groups: this.calls.groups,
    };
  }

  async topClients(q: TopClientsQuery): Promise<TopClientsResponse> {
    const calls = await this.load(q);
    return {
      range: { from: q.from, to: q.to, scope: q.scope },
      clients: topClients(calls, q.scope, q.limit, wallToIso),
    };
  }
}
