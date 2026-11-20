import {
  type CallHistoryResponse,
  CallHistoryResponseSchema,
  type KpiExecutiveTicketListQuery,
  KpiExecutiveTicketListQuerySchema,
  type KpiOperatorCallListQuery,
  KpiOperatorCallListQuerySchema,
  type KpiOperatorTicketListQuery,
  KpiOperatorTicketListQuerySchema,
  type OverviewTicketList,
  OverviewTicketListSchema,
  type KpiExecutivesQuery,
  KpiExecutivesQuerySchema,
  type KpiExecutivesResponse,
  KpiExecutivesResponseSchema,
  type KpiOperatorsQuery,
  KpiOperatorsQuerySchema,
  type KpiOperatorsResponse,
  KpiOperatorsResponseSchema,
} from '@cc/shared';
import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { KpiService } from './kpi.service.js';

/**
 * The staff KPI page «KPI xodimlar» (owner, 19.11.2026): observers and the superuser (`kpi.view` on every endpoint).
 * Figures (docs/rewrite/METRICS.md §11) and the records behind each of them (§11.4): calls and tickets in the overview
 * dashboard's list shapes; their read-only cards (call, recording, AI analysis, ticket) are the overview's endpoints.
 */
@Controller('kpi')
@RequirePermission('kpi.view')
export class KpiController {
  constructor(private readonly kpi: KpiService) {}

  /** One row per operator: calls, client ratings, tickets and callbacks, AI call quality, online / pause time. */
  @Get('operators')
  @SerializeOptions({ schema: KpiOperatorsResponseSchema })
  operators(@Query({ schema: KpiOperatorsQuerySchema }) q: KpiOperatorsQuery): Promise<KpiOperatorsResponse> {
    return this.kpi.operators(q);
  }

  /** The calls behind one operator's call or quality number. */
  @Get('operators/calls')
  @SerializeOptions({ schema: CallHistoryResponseSchema })
  operatorCalls(
    @Query({ schema: KpiOperatorCallListQuerySchema }) q: KpiOperatorCallListQuery,
  ): Promise<CallHistoryResponse> {
    return this.kpi.operatorCalls(q);
  }

  /** The tickets behind one operator's ticket number. */
  @Get('operators/tickets')
  @SerializeOptions({ schema: OverviewTicketListSchema })
  operatorTickets(
    @Query({ schema: KpiOperatorTicketListQuerySchema }) q: KpiOperatorTicketListQuery,
  ): Promise<OverviewTicketList> {
    return this.kpi.operatorTickets(q);
  }

  /** The tickets behind one Mas'ul number (the whole row or one region). */
  @Get('executives/tickets')
  @SerializeOptions({ schema: OverviewTicketListSchema })
  executiveTickets(
    @Query({ schema: KpiExecutiveTicketListQuerySchema }) q: KpiExecutiveTicketListQuery,
  ): Promise<OverviewTicketList> {
    return this.kpi.executiveTickets(q);
  }

  /** One row per "Mas'ul" (executive), with the same figures per region. */
  @Get('executives')
  @SerializeOptions({ schema: KpiExecutivesResponseSchema })
  executives(@Query({ schema: KpiExecutivesQuerySchema }) q: KpiExecutivesQuery): Promise<KpiExecutivesResponse> {
    return this.kpi.executives(q);
  }
}
