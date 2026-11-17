import {
  CDR_ACCESS,
  CallDetailsResponseSchema,
  type CallDetailsResponse,
  CallHistoryQuerySchema,
  type CallHistoryQuery,
  CallHistoryResponseSchema,
  type CallHistoryResponse,
  CallIdSchema,
  type SessionUser,
} from '@cc/shared';
import { Controller, Get, Param, Query, SerializeOptions } from '@nestjs/common';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators.js';
import { CdrService } from './cdr.service.js';

/**
 * Call history from the PBX CDR. Access: CDR_ACCESS['calls.read'] (legacy let operators see call lists through
 * the viewer's /api/calls/details); recording file names need CDR_ACCESS['calls.recordings'].
 */
@Controller('cdr')
@Roles(CDR_ACCESS['calls.read'])
export class CdrController {
  constructor(private readonly cdr: CdrService) {}

  @Get('calls')
  @SerializeOptions({ schema: CallHistoryResponseSchema })
  list(
    @Query({ schema: CallHistoryQuerySchema }) query: CallHistoryQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<CallHistoryResponse> {
    return this.cdr.history(query, user);
  }

  @Get('calls/:id')
  @SerializeOptions({ schema: CallDetailsResponseSchema })
  details(
    @Param('id', { schema: CallIdSchema }) id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<CallDetailsResponse> {
    return this.cdr.details(id, user);
  }
}
