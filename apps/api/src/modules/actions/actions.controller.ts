import {
  type HangupCallRequest,
  HangupCallRequestSchema,
  type OriginateCallRequest,
  OriginateCallRequestSchema,
  type PauseOperatorRequest,
  PauseOperatorRequestSchema,
  type SessionUser,
  type TelephonyActionResult,
  TelephonyActionResultSchema,
  type TransferCallRequest,
  TransferCallRequestSchema,
} from '@cc/shared';
import { Body, Controller, HttpCode, Post, SerializeOptions } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import { ActionsService } from './actions.service.js';

/** Telephony actions. Any logged-in user; operators are limited to their own extension/calls in the service. */
@Controller('telephony')
export class ActionsController {
  constructor(private readonly actions: ActionsService) {}

  @Post('pause')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @SerializeOptions({ schema: TelephonyActionResultSchema })
  pause(
    @CurrentUser() user: SessionUser,
    @Body({ schema: PauseOperatorRequestSchema }) body: PauseOperatorRequest,
  ): Promise<TelephonyActionResult> {
    return this.actions.pause(user, body);
  }

  @Post('transfer')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @SerializeOptions({ schema: TelephonyActionResultSchema })
  transfer(
    @CurrentUser() user: SessionUser,
    @Body({ schema: TransferCallRequestSchema }) body: TransferCallRequest,
  ): Promise<TelephonyActionResult> {
    return this.actions.transfer(user, body);
  }

  @Post('hangup')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @SerializeOptions({ schema: TelephonyActionResultSchema })
  hangup(
    @CurrentUser() user: SessionUser,
    @Body({ schema: HangupCallRequestSchema }) body: HangupCallRequest,
  ): Promise<TelephonyActionResult> {
    return this.actions.hangup(user, body);
  }

  @Post('originate')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SerializeOptions({ schema: TelephonyActionResultSchema })
  originate(
    @CurrentUser() user: SessionUser,
    @Body({ schema: OriginateCallRequestSchema }) body: OriginateCallRequest,
  ): Promise<TelephonyActionResult> {
    return this.actions.originate(user, body);
  }
}
