import {
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
 * Figures only (docs/rewrite/METRICS.md §10); the records behind them are the overview dashboard's detail endpoints.
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

  /** One row per "Mas'ul" (executive), with the same figures per region. */
  @Get('executives')
  @SerializeOptions({ schema: KpiExecutivesResponseSchema })
  executives(@Query({ schema: KpiExecutivesQuerySchema }) q: KpiExecutivesQuery): Promise<KpiExecutivesResponse> {
    return this.kpi.executives(q);
  }
}
