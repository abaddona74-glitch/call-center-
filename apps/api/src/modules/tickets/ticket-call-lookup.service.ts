import { type SessionUser, normalizeUzPhone } from '@cc/shared';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import { LiveService } from '../live/live.service.js';
import type { TicketActor } from './domain/ticket-workflow.js';

export interface ResolvedCall {
  callId: string;
  source: 'live' | 'history';
  /** Citizen number, normalized; null when hidden. */
  phone: string | null;
  /** The operator extension on the call. */
  extension: string | null;
  startedAt: Date | null;
  /** History calls are over; live ones end later (AMI `call.ended`). */
  ended: boolean;
  answered: boolean;
  talkSeconds: number | null;
}

/**
 * Finds the call a ticket is opened from: first in the live AMI state (a call in progress), then in the
 * PBX CDR (a past call from the history). The phone number always comes from the call, never from the
 * request. Operators may only use calls they took part in.
 */
@Injectable()
export class TicketCallLookup {
  constructor(
    private readonly live: LiveService,
    private readonly pbxCalls: PbxCallsService,
  ) {}

  async resolve(actor: TicketActor, user: SessionUser, callId: string): Promise<ResolvedCall> {
    const anyCall = actor.capabilities.administer;
    const live = this.live.callControl(callId)?.call;
    if (live) {
      if (!anyCall && (!user.extension || live.extension !== user.extension)) {
        throw new ForbiddenException('You can only open a ticket for your own call');
      }
      return {
        callId: live.id,
        source: 'live',
        phone: normalizeUzPhone(live.phone),
        extension: live.extension,
        startedAt: new Date(live.startedAt),
        ended: false,
        answered: live.answeredAt !== null,
        talkSeconds: null,
      };
    }

    const found = await this.pbxCalls.findCall(callId);
    if (!found) throw new NotFoundException('Call not found');
    const call = found.call;
    const ext = user.extension;
    const tookPart = ext !== null && (call.operators.includes(ext) || call.firstOperator === ext || call.finalOperator === ext);
    if (!anyCall && !tookPart) throw new ForbiddenException('You can only open a ticket for a call you took part in');
    return {
      callId: call.id,
      source: 'history',
      phone: call.clientNumber,
      extension: (ext && tookPart ? ext : call.finalOperator) ?? null,
      startedAt: new Date(call.startEpochMs),
      ended: true,
      answered: call.status === 'answered',
      talkSeconds: call.talkSec,
    };
  }
}
