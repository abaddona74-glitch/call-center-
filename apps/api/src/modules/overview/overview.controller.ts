import {
  type OverviewCalls,
  type OverviewCallsQuery,
  OverviewCallsQuerySchema,
  OverviewCallsSchema,
  type OverviewTickets,
  type OverviewTicketsQuery,
  OverviewTicketsQuerySchema,
  OverviewTicketsSchema,
} from '@cc/shared';
import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { OverviewService } from './overview.service.js';

/**
 * The overview dashboard (owner, 19.11.2026): observers see only this; the superuser sees it too.
 * Aggregates only (docs/rewrite/METRICS.md §9). Every endpoint needs `overview.view`.
 */
@Controller('overview')
@RequirePermission('overview.view')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get('tickets')
  @SerializeOptions({ schema: OverviewTicketsSchema })
  tickets(@Query({ schema: OverviewTicketsQuerySchema }) q: OverviewTicketsQuery): Promise<OverviewTickets> {
    return this.overview.tickets(q);
  }

  @Get('calls')
  @SerializeOptions({ schema: OverviewCallsSchema })
  calls(@Query({ schema: OverviewCallsQuerySchema }) q: OverviewCallsQuery): Promise<OverviewCalls> {
    return this.overview.calls(q);
  }
}
