import {
  CDR_ACCESS,
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
 * Access per capability: CDR_ACCESS in @cc/shared (legacy parity; switches to permissions in one place).
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
  @Roles(CDR_ACCESS['stats.read'])
  @SerializeOptions({ schema: StatsSummarySchema })
  summary(@Query({ schema: StatsQuerySchema }) q: StatsQuery): Promise<StatsSummary> {
    return this.stats.summary(q);
  }

  @Get('series')
  @Roles(CDR_ACCESS['stats.read'])
  @SerializeOptions({ schema: StatsSeriesResponseSchema })
  series(@Query({ schema: StatsQuerySchema }) q: StatsQuery): Promise<StatsSeriesResponse> {
    return this.stats.series(q);
  }

  @Get('operators')
  @Roles(CDR_ACCESS['stats.operators'])
  @SerializeOptions({ schema: OperatorStatsResponseSchema })
  operators(@Query({ schema: OperatorStatsQuerySchema }) q: OperatorStatsQuery): Promise<OperatorStatsResponse> {
    return this.stats.operators(q);
  }

  @Get('top-clients')
  @Roles(CDR_ACCESS['stats.read'])
  @SerializeOptions({ schema: TopClientsResponseSchema })
  topClients(@Query({ schema: TopClientsQuerySchema }) q: TopClientsQuery): Promise<TopClientsResponse> {
    return this.stats.topClients(q);
  }
}
