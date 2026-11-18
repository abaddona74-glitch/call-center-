import {
  type ExcludedOperatorsInfo,
  type ExcludedOperatorsInput,
  ExcludedOperatorsInputSchema,
  ExcludedOperatorsSchema,
  type SessionUser,
} from '@cc/shared';
import { Body, Controller, Get, Put, SerializeOptions } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators.js';
import { ExcludedOperatorsService } from './excluded-operators.service.js';

/**
 * Excluded operators (legacy `GET/POST /api/settings/exclude-list`, superuser only). Only the settings screen
 * needs the list: the board, statistics and export are filtered on the server, so other roles never read it.
 */
@Controller('excluded-operators')
@RequirePermission('settings.manage')
export class ExcludedOperatorsController {
  constructor(private readonly excluded: ExcludedOperatorsService) {}

  @Get()
  @SerializeOptions({ schema: ExcludedOperatorsSchema })
  get(): Promise<ExcludedOperatorsInfo> {
    return this.excluded.info();
  }

  @Put()
  @SerializeOptions({ schema: ExcludedOperatorsSchema })
  update(
    @Body({ schema: ExcludedOperatorsInputSchema }) body: ExcludedOperatorsInput,
    @CurrentUser() user: SessionUser,
  ): Promise<ExcludedOperatorsInfo> {
    return this.excluded.update(body, user);
  }
}
