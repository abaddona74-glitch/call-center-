import type {
  HangupCallRequest,
  OriginateCallRequest,
  PauseOperatorRequest,
  SessionUser,
  TelephonyActionResult,
  TransferCallRequest,
} from '@cc/shared';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { AmiService } from '../ami/ami.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LiveService } from '../live/live.service.js';
import { type Decision, canControlCall, resolveDialTarget, resolveExtension, validateTransferTarget } from './domain/action-rules.js';

/**
 * Telephony actions through AMI only (no SSH / CLI): pause (QueuePause), transfer (Redirect),
 * hangup, click-to-call (async Originate). Identity and role come from the session; every
 * attempt is written to the audit log with its outcome.
 */
@Injectable()
export class ActionsService {
  private readonly operatorExt: RegExp;
  private readonly allowedNumbers: RegExp[];

  constructor(
    private readonly ami: AmiService,
    private readonly live: LiveService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {
    this.operatorExt = new RegExp(config.get('LIVE_OPERATOR_EXTENSION_PATTERN'));
    this.allowedNumbers = config.get('ORIGINATE_ALLOWED_PATTERNS').map((p) => new RegExp(p));
  }

  async pause(user: SessionUser, req: PauseOperatorRequest): Promise<TelephonyActionResult> {
    const ext = unwrap(resolveExtension(user, req.extension, this.operatorExt));
    const member = this.config.get('AMI_QUEUE_MEMBER_INTERFACE').replace('{ext}', ext);
    const action = req.paused ? 'telephony.pause' : 'telephony.unpause';
    await this.audited(action, `extension:${ext}`, { reason: req.reason ?? null }, () =>
      // No Queue: all queues the member belongs to (as legacy "queue pause member").
      this.ami.queuePause({ member, paused: req.paused, reason: req.paused ? req.reason : undefined }),
    );
    return { ok: true };
  }

  async transfer(user: SessionUser, req: TransferCallRequest): Promise<TelephonyActionResult> {
    const ctl = this.controlledCall(user, req.callId);
    const target = unwrap(validateTransferTarget(req.target, ctl.call.extension, this.operatorExt));
    const channel = ctl.partyChannel ?? ctl.operatorChannel;
    if (!channel) throw new ConflictException('This call has no transferable leg');
    await this.audited(
      'telephony.transfer',
      `call:${req.callId}`,
      { from: ctl.call.extension, to: target, phone: ctl.call.phone },
      async () => {
        this.live.store.markRedirect(channel, Date.now());
        await this.ami.redirect({ channel, exten: target, context: this.config.get('AMI_DIAL_CONTEXT') });
      },
    );
    return { ok: true };
  }

  async hangup(user: SessionUser, req: HangupCallRequest): Promise<TelephonyActionResult> {
    const ctl = this.controlledCall(user, req.callId);
    const channel = ctl.partyChannel ?? ctl.operatorChannel;
    if (!channel) throw new ConflictException('This call has no channel to hang up');
    await this.audited('telephony.hangup', `call:${req.callId}`, { extension: ctl.call.extension, phone: ctl.call.phone }, async () => {
      this.live.store.markStaffHangup(channel, Date.now());
      await this.ami.hangup(channel);
    });
    return { ok: true };
  }

  async originate(user: SessionUser, req: OriginateCallRequest): Promise<TelephonyActionResult> {
    const from = unwrap(resolveExtension(user, req.from, this.operatorExt));
    const target = unwrap(resolveDialTarget(req.to, this.allowedNumbers, this.operatorExt));
    if (target.dial === from) throw new BadRequestException('Cannot call your own extension');
    const op = this.live.operator(from);
    if (op && op.presence === 'offline') throw new ConflictException(`Extension ${from} is offline`);
    if (op && (op.presence === 'talking' || op.presence === 'ringing')) throw new ConflictException(`Extension ${from} is busy`);
    await this.audited('telephony.originate', `extension:${from}`, { to: target.dial }, async () => {
      if (target.phone) this.live.store.expectOriginate(from, target.phone, Date.now());
      await this.ami.originate({
        channel: `${this.config.get('AMI_CHANNEL_TECH')}/${from}`,
        exten: target.dial,
        context: this.config.get('AMI_DIAL_CONTEXT'),
        // Shown on the operator's phone while it rings: the number about to be called.
        callerId: target.dial,
      });
    });
    return { ok: true, message: 'Calling your phone…' };
  }

  // --- helpers --------------------------------------------------------------------------------

  private controlledCall(user: SessionUser, callId: string) {
    const ctl = this.live.callControl(callId);
    if (!ctl) throw new NotFoundException('Call not found or already ended');
    if (!canControlCall(user, ctl.call)) throw new ForbiddenException('You can only control your own calls');
    return ctl;
  }

  private async audited(action: string, target: string, details: Record<string, unknown>, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      const message = err instanceof HttpException ? err.message : 'internal error';
      await this.audit.record(`${action}.failed`, { target, details: { ...details, error: message } });
      throw err;
    }
    await this.audit.record(action, { target, details });
  }
}

function unwrap<T>(d: Decision<T>): T {
  if (d.ok) return d.value;
  throw d.status === 403 ? new ForbiddenException(d.message) : new BadRequestException(d.message);
}
