import {
  type CallAttemptStatus,
  type CallbackOutcome,
  type SessionUser,
  type TicketCloseOutcome,
  type TicketDetail,
  normalizeUzPhone,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import { ConflictException, ForbiddenException, HttpException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { type CallAnsweredEvent, type CallEndedEvent, CallEvents } from '../../common/events/domain-events.js';
import { ActionsService } from '../actions/actions.service.js';
import { AuditService } from '../audit/audit.service.js';
import { scheduleForEndedCall, scheduleForRunningCall } from './domain/recording-link.js';
import {
  ATTEMPT_MATCH_WINDOW_MS,
  attemptStatusAfterEnd,
  decideAfterEnd,
  decideOutcome,
  eventMatchesAttempt,
  isOpenAttempt,
} from './domain/ticket-callback.js';
import { canCallBack, canForceClose } from './domain/ticket-workflow.js';
import { TicketNotifier } from './ticket-notifier.service.js';
import { TicketPresenter, openAttemptOf, ticketFacts } from './ticket-presenter.service.js';
import { TicketsRepository } from './tickets.repository.js';
import { type Me, TicketsService } from './tickets.service.js';
import type { TicketCallRow, TicketRow } from './tickets.tables.js';

/**
 * The callback step: operators call the citizen back from the shared queue (AMI Originate from their own
 * extension, only to the ticket's number), AMI call events confirm the conversation (≥ 10 s), the operator
 * records the outcome; the ticket closes when both are there. Also tracks who last talked to a citizen.
 */
@Injectable()
export class TicketCallbacksService {
  private readonly logger = new Logger(TicketCallbacksService.name);

  constructor(
    private readonly repo: TicketsRepository,
    private readonly tickets: TicketsService,
    private readonly presenter: TicketPresenter,
    private readonly notifier: TicketNotifier,
    private readonly actions: ActionsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Operator actions
  // ---------------------------------------------------------------------------

  async call(user: SessionUser, id: number): Promise<TicketDetail> {
    const actor = await this.presenter.actorFor(user);
    const row = await this.tickets.visibleRow(id, actor);
    if (!canCallBack(actor, ticketFacts(row))) {
      if (row.status !== 'callback_pending') throw new ConflictException('The ticket is not waiting for a callback');
      await this.audit.record('tickets.denied', { target: `ticket:${id}`, details: { action: 'callback.call', kind: actor.kind } });
      throw new ForbiddenException(user.extension ? 'You cannot call back this ticket' : 'Your account has no extension');
    }
    const me = await this.tickets.me(user);
    const attempt = await this.claimAttempt(row, me);
    try {
      // Same rules as the click-to-call button: own extension only, number allow-list, audit.
      await this.actions.originate(user, { to: row.customerPhone as string });
    } catch (err) {
      await this.repo.updateCall(attempt.id, { attemptStatus: 'failed', recordingStatus: 'none' });
      await this.notifier.changed(row, row, 'callback', { userId: me.userId, label: me.label }, { attemptStatus: 'failed' });
      throw err;
    }
    await this.audit.record('tickets.callback.call', { target: `ticket:${id}`, details: { attemptId: attempt.id, extension: me.extension } });
    await this.notifier.changed(row, row, 'callback', { userId: me.userId, label: me.label }, { attemptStatus: 'dialing' });
    return this.presenter.detail(row, actor);
  }

  /** One running callback per ticket: a second operator gets 409 instead of calling the same citizen. */
  @Transactional()
  private async claimAttempt(row: TicketRow, me: Me): Promise<TicketCallRow> {
    const locked = await this.repo.findForUpdate(row.id);
    if (!locked || locked.status !== 'callback_pending') throw new ConflictException('The ticket is not waiting for a callback');
    const now = new Date();
    const running = (await this.repo.callsOf([row.id])).find(
      (c) => c.kind === 'callback' && isOpenAttempt({ status: c.attemptStatus ?? 'failed', startedAt: new Date(c.startedAt) }, now),
    );
    if (running) {
      throw new ConflictException(
        running.userId === me.userId ? 'Your call to this citizen is still in progress' : `${running.userLabel ?? 'Another operator'} is calling this citizen now`,
      );
    }
    const schedule = scheduleForRunningCall(now);
    return this.repo.insertCall({
      ticketId: row.id,
      kind: 'callback',
      phone: locked.customerPhone,
      extension: me.extension,
      userId: me.userId,
      userLabel: me.label,
      startedAt: now,
      attemptStatus: 'dialing',
      recordingNextAt: schedule.nextAt,
      recordingDeadline: schedule.deadline,
    });
  }

  async recordOutcome(user: SessionUser, id: number, outcome: CallbackOutcome, note: string | undefined): Promise<TicketDetail> {
    const actor = await this.presenter.actorFor(user);
    const row = await this.tickets.visibleRow(id, actor);
    if (!canCallBack(actor, ticketFacts(row))) {
      if (row.status !== 'callback_pending') throw new ConflictException('The ticket is not waiting for a callback');
      throw new ForbiddenException('You cannot call back this ticket');
    }
    const attempt = openAttemptOf(await this.repo.callsOf([row.id]), user.id);
    if (!attempt) throw new ConflictException('Call the citizen first');
    const decision = decideOutcome(attempt.attemptStatus ?? 'failed', outcome);
    if (decision.kind === 'error') throw new ConflictException(decision.message);

    const me = await this.tickets.me(user);
    const updated = await this.persistOutcome(row.id, attempt.id, outcome, note?.trim() || null, decision.kind, me);
    await this.notifier.changed(row, updated, decision.kind === 'close' ? 'closed' : 'callback', { userId: me.userId, label: me.label });
    return this.presenter.detail(updated, actor);
  }

  @Transactional()
  private async persistOutcome(
    ticketId: number,
    attemptId: number,
    outcome: CallbackOutcome,
    note: string | null,
    kind: 'close' | 'pending' | 'attempt',
    me: Me,
  ): Promise<TicketRow> {
    const row = await this.repo.findForUpdate(ticketId);
    if (!row || row.status !== 'callback_pending') throw new ConflictException('The ticket is not waiting for a callback');
    await this.repo.updateCall(attemptId, { outcome, outcomeNote: note, outcomeAt: new Date() });
    await this.audit.record('tickets.callback.outcome', { target: `ticket:${ticketId}`, details: { attemptId, outcome, result: kind } });
    if (kind === 'pending') return row;
    if (kind === 'attempt') return this.countAttempt(row, me, outcome, note);
    return this.close(row, me, outcome, note);
  }

  async forceClose(user: SessionUser, id: number, note: string): Promise<TicketDetail> {
    const actor = await this.presenter.actorFor(user);
    const row = await this.tickets.visibleRow(id, actor);
    if (!canForceClose(actor, ticketFacts(row))) {
      if (!actor.capabilities.administer) throw new ForbiddenException('Only the superuser can close a ticket without a call');
      throw new ConflictException('The ticket is not waiting for a callback');
    }
    const me = await this.tickets.me(user);
    const updated = await this.persistForceClose(row.id, me, note);
    await this.notifier.changed(row, updated, 'closed', { userId: me.userId, label: me.label });
    return this.presenter.detail(updated, actor);
  }

  @Transactional()
  private async persistForceClose(id: number, me: Me, note: string): Promise<TicketRow> {
    const row = await this.repo.findForUpdate(id);
    if (!row || row.status !== 'callback_pending') throw new ConflictException('The ticket is not waiting for a callback');
    await this.audit.record('tickets.close.forced', { target: `ticket:${id}`, details: { note } });
    return this.close(row, me, 'forced', note, false);
  }

  /** Inside a transaction with the ticket row locked. */
  private async close(row: TicketRow, by: Me, outcome: TicketCloseOutcome, note: string | null, counts = true): Promise<TicketRow> {
    const updated = await this.repo.update(
      row.id,
      {
        status: 'closed',
        closedAt: new Date(),
        closedByUserId: by.userId,
        closedByLabel: by.label,
        closedByExtension: by.extension,
        callbackOutcome: outcome,
        callbackNote: note,
        callbackAttempts: row.callbackAttempts + (counts ? 1 : 0),
      },
      row.version,
    );
    if (!updated) throw new ConflictException('The ticket was changed by someone else; refresh and try again');
    await this.repo.insertEvents([this.tickets.event(row.id, 'closed', by, { fromStatus: 'callback_pending', toStatus: 'closed', note: note ?? outcome })]);
    await this.audit.record('tickets.close', { target: `ticket:${row.id}`, details: { outcome }, actorLabel: by.label });
    return updated;
  }

  private async countAttempt(row: TicketRow, by: Me, outcome: CallbackOutcome, note: string | null): Promise<TicketRow> {
    const updated = await this.repo.update(row.id, { callbackAttempts: row.callbackAttempts + 1 }, row.version);
    if (!updated) throw new ConflictException('The ticket was changed by someone else; refresh and try again');
    await this.repo.insertEvents([this.tickets.event(row.id, 'callback_attempt', by, { note: note ? `${outcome}: ${note}` : outcome })]);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // AMI call events (from the live module)
  // ---------------------------------------------------------------------------

  @OnEvent(CallEvents.Answered)
  async onAnswered(e: CallAnsweredEvent): Promise<void> {
    await this.safely('answered', async () => {
      const at = new Date(e.at);
      if (e.direction !== 'outbound' || Number.isNaN(at.getTime())) return;
      const facts = { callId: e.callId, direction: e.direction, extension: e.extension, phone: normalizeUzPhone(e.phone), at };
      const open = await this.repo.openAttemptsOnExtension(e.extension, new Date(at.getTime() - ATTEMPT_MATCH_WINDOW_MS));
      const attempt = open.find((a) => !a.callId && eventMatchesAttempt(this.attemptFacts(a), facts));
      if (!attempt) return;
      await this.repo.updateCall(attempt.id, { callId: e.callId, answeredAt: at, attemptStatus: 'answered' });
      const row = await this.repo.findById(attempt.ticketId);
      if (row) await this.notifier.changed(row, row, 'callback', { userId: attempt.userId, label: attempt.userLabel ?? 'Operator' }, { attemptStatus: 'answered' });
    });
  }

  @OnEvent(CallEvents.Ended)
  async onEnded(e: CallEndedEvent): Promise<void> {
    await this.safely('ended', async () => {
      const at = new Date(e.at);
      if (Number.isNaN(at.getTime())) return;
      const phone = normalizeUzPhone(e.phone);
      const talk = Math.max(0, Math.round(e.talkSeconds));
      const facts = { callId: e.callId, direction: e.direction, extension: e.extension, phone, at };

      const rows = await this.repo.callsWithCallId(e.callId);
      if (e.direction === 'outbound' && e.extension) {
        const open = await this.repo.openAttemptsOnExtension(e.extension, new Date(at.getTime() - ATTEMPT_MATCH_WINDOW_MS - 3_600_000));
        for (const a of open) if (!a.callId && eventMatchesAttempt(this.attemptFacts(a), facts)) rows.push(a);
      }
      for (const row of rows) {
        if (row.kind === 'origin') await this.originEnded(row, e.answered, talk);
        else if (row.attemptStatus === 'dialing' || row.attemptStatus === 'answered') await this.attemptEnded(row, e, talk);
      }
      if (e.answered && phone && e.extension && e.direction !== 'internal' && talk > 0) await this.lastContact(phone, e.extension, at);
    });
  }

  private attemptFacts(a: TicketCallRow) {
    return { extension: a.extension, phone: a.phone, startedAt: new Date(a.startedAt), callId: a.callId, status: a.attemptStatus ?? 'failed' } as const;
  }

  private async originEnded(row: TicketCallRow, answered: boolean, talk: number): Promise<void> {
    if (row.endedAt) return;
    const schedule = scheduleForEndedCall(new Date(), this.tickets.lookupMs);
    await this.repo.updateCall(row.id, {
      endedAt: new Date(),
      talkSeconds: talk,
      ...(row.recordingStatus === 'pending' ? { recordingNextAt: schedule.nextAt, recordingDeadline: schedule.deadline } : {}),
    });
  }

  private async attemptEnded(row: TicketCallRow, e: CallEndedEvent, talk: number): Promise<void> {
    const status: CallAttemptStatus = attemptStatusAfterEnd(e.answered, talk);
    const schedule = scheduleForEndedCall(new Date(), this.tickets.lookupMs);
    await this.repo.updateCall(row.id, {
      callId: row.callId ?? e.callId,
      endedAt: new Date(e.at),
      talkSeconds: talk,
      attemptStatus: status,
      ...(e.answered ? { recordingNextAt: schedule.nextAt, recordingDeadline: schedule.deadline } : { recordingStatus: 'none' as const }),
    });
    const by: Me = { userId: row.userId as number, label: row.userLabel ?? 'Operator', extension: row.extension };
    const next = decideAfterEnd(status, row.outcome);
    const before = await this.repo.findById(row.ticketId);
    if (!before) return;
    let after = before;
    if (next !== 'wait' && row.outcome && before.status === 'callback_pending') {
      after = await this.applyAfterEnd(row.ticketId, next, by, row.outcome, row.outcomeNote);
    }
    await this.notifier.changed(before, after, after.status === 'closed' ? 'closed' : 'callback', { userId: by.userId, label: by.label }, { attemptStatus: status });
  }

  @Transactional()
  private async applyAfterEnd(ticketId: number, next: 'close' | 'attempt', by: Me, outcome: CallbackOutcome, note: string | null): Promise<TicketRow> {
    const row = await this.repo.findForUpdate(ticketId);
    if (!row || row.status !== 'callback_pending') return row as TicketRow;
    return next === 'close' ? this.close(row, by, outcome, note) : this.countAttempt(row, by, outcome, note);
  }

  /** Who talked to the citizen last — the callback queue shows "your" citizens first. */
  private async lastContact(phone: string, extension: string, at: Date): Promise<void> {
    const user = await this.repo.activeUserByExtension(extension);
    const label = user ? await this.presenter.label(user) : ((await this.repo.operatorNames()).get(extension) ?? `Operator ${extension}`);
    await this.repo.setLastContact(phone, { userId: user?.id ?? null, label, extension, at });
  }

  private async safely(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof HttpException ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err);
      this.logger.error(`call.${what} handling for tickets failed: ${msg}`);
    }
  }
}
