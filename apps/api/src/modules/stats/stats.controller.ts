import {
  type OperatorStatsQuery,
  OperatorStatsQuerySchema,
  type OperatorStatsResponse,
  OperatorStatsResponseSchema,
  type StatsQuery,
  StatsQuerySchema,
  type StatsSeriesResponse,
  StatsSeriesResponseSchema,
  type StatsSummary,
  StatsSummarySchema,
  type TopClientsQuery,
  TopClientsQuerySchema,
  type TopClientsResponse,
  TopClientsResponseSchema,
  type WorkingCalendarInfo,
  WorkingCalendarSchema,
} from '@cc/shared';
import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import { Roles } from '../../common/decorators/auth.decorators.js';
import { StatsService } from './stats.service.js';

/**
 * Historical statistics from the PBX CDR (definitions: docs/rewrite/METRICS.md).
 * Admin-only except the per-operator table, which legacy also served to operators (viewer → /api/operators?date).
 */
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('calendar')
  @SerializeOptions({ schema: WorkingCalendarSchema })
  calendar(): WorkingCalendarInfo {
    return this.stats.calendar();
  }

  @Get('summary')
  @Roles('admin')
  @SerializeOptions({ schema: StatsSummarySchema })
  summary(@Query({ schema: StatsQuerySchema }) q: StatsQuery): Promise<StatsSummary> {
    return this.stats.summary(q);
  }

  @Get('series')
  @Roles('admin')
  @SerializeOptions({ schema: StatsSeriesResponseSchema })
  series(@Query({ schema: StatsQuerySchema }) q: StatsQuery): Promise<StatsSeriesResponse> {
    return this.stats.series(q);
  }

  @Get('operators')
  @SerializeOptions({ schema: OperatorStatsResponseSchema })
  operators(@Query({ schema: OperatorStatsQuerySchema }) q: OperatorStatsQuery): Promise<OperatorStatsResponse> {
    return this.stats.operators(q);
  }

  @Get('top-clients')
  @Roles('admin')
  @SerializeOptions({ schema: TopClientsResponseSchema })
  topClients(@Query({ schema: TopClientsQuerySchema }) q: TopClientsQuery): Promise<TopClientsResponse> {
    return this.stats.topClients(q);
  }
}
