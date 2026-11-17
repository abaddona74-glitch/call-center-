import {
  BUSINESS_TIMEZONE,
  type Callback,
  type CallbackDetails,
  type CallbackListQuery,
  type CallbackListResponse,
  type CallbackResolutionType,
  type CallbackSettings,
  type CallbackSource,
  type OutboundFailureCause,
  type SessionUser,
  hasRoleAtLeast,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { type DayWindow, CallbacksRepository } from './callbacks.repository.js';
import { decideConversation, decideMissed, decideOutboundFailure } from './domain/callback-rules.js';
import { type WorkingCalendar, businessDate, dayBounds } from './domain/working-calendar.js';

export interface MissedCallInput {
  /** Asterisk linkedid; null when unknown (then the call cannot be de-duplicated). */
  callId: string | null;
  phone: string;
  at: Date;
  source: CallbackSource;
}

export interface ConversationInput {
  callId: string | null;
  phone: string;
  direction: 'inbound' | 'outbound';
  extension: string | null;
  endedAt: Date;
  talkSeconds: number;
}

export interface OutboundFailureInput {
  callId: string | null;
  phone: string;
  extension: string | null;
  at: Date;
  cause: OutboundFailureCause;
}

export type ApplyOutcome = 'created' | 'appended' | 'resolved' | 'short' | 'attempt' | 'skipped';

/** Thrown inside a transaction to roll it back when a concurrent writer handled the same call. */
class DuplicateCallError extends Error {}

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Callback use cases. Automatic changes come from call facts (live AMI events or the CDR
 * reconciliation); manual ones from users and are audited. Every change is pushed over WS
 * as `callbacks.updated` after the transaction commits.
 */
@Injectable()
export class CallbacksService {
  private readonly logger = new Logger(CallbacksService.name);
  private settingsCache: CallbackSettings | null = null;

  constructor(
    private readonly repo: CallbacksRepository,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // ------------------------------------------------------------ settings

  async settings(): Promise<CallbackSettings> {
    this.settingsCache ??= await this.repo.getSettings();
    return this.settingsCache;
  }

  async calendar(): Promise<WorkingCalendar> {
    const s = await this.settings();
    return {
      timezone: BUSINESS_TIMEZONE,
      workDays: s.workDays,
      workStart: s.workStart,
      workEnd: s.workEnd,
      holidays: s.holidays,
    };
  }

  @Transactional()
  async updateSettings(next: CallbackSettings, user: SessionUser): Promise<CallbackSettings> {
    const before = await this.repo.getSettings();
    await this.repo.saveSettings(next, user.id);
    await this.audit.record('callbacks.settings.update', {
      target: 'callback_settings',
      details: { before, after: next },
    });
    this.settingsCache = null;
    return this.repo.getSettings();
  }

  // ------------------------------------------------------------ automatic: call facts

  async recordMissed(input: MissedCallInput): Promise<ApplyOutcome> {
    return this.applyAndPublish(() => this.applyMissed(input));
  }

  async recordConversation(input: ConversationInput): Promise<ApplyOutcome> {
    const { minTalkSeconds } = await this.settings();
    return this.applyAndPublish(() => this.applyConversation(input, minTalkSeconds));
  }

  async recordOutboundFailure(input: OutboundFailureInput): Promise<ApplyOutcome> {
    return this.applyAndPublish(() => this.applyOutboundFailure(input));
  }

  /** Runs one fact without broadcasting (the reconciliation publishes once per run). */
  async applyQuietly(
    run: () => Promise<{ outcome: ApplyOutcome; callbackId: number | null }>,
  ): Promise<{ outcome: ApplyOutcome; callbackId: number | null }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run();
      } catch (err) {
        if (err instanceof DuplicateCallError) return { outcome: 'skipped', callbackId: null };
        // Two writers opened a callback for the same phone at once: the loser retries and appends.
        if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION && attempt < 2) continue;
        throw err;
      }
    }
  }

  private async applyAndPublish(
    run: () => Promise<{ outcome: ApplyOutcome; callbackId: number | null }>,
  ): Promise<ApplyOutcome> {
    const { outcome, callbackId } = await this.applyQuietly(run);
    if (callbackId !== null) await this.publish([callbackId]);
    return outcome;
  }

  @Transactional()
  async applyMissed(input: MissedCallInput): Promise<{ outcome: ApplyOutcome; callbackId: number | null }> {
    if (input.callId && (await this.repo.eventExists('missed', input.callId)))
      return { outcome: 'skipped', callbackId: null };
    const open = await this.repo.findOpenForUpdate(input.phone);
    const lastClosed = open ? null : await this.repo.findLastClosed(input.phone);
    const decision = decideMissed({ at: input.at, source: input.source }, open, lastClosed);

    if (decision.action === 'skip') return { outcome: 'skipped', callbackId: null };

    let callbackId: number;
    let outcome: ApplyOutcome;
    if (decision.action === 'create') {
      callbackId = await this.repo.insertCallback({ phone: input.phone, source: input.source, at: input.at });
      outcome = 'created';
    } else {
      callbackId = decision.callbackId;
      await this.repo.incrementMissed(callbackId, {
        firstMissedAt: decision.firstMissedAt,
        lastMissedAt: decision.lastMissedAt,
        sources: decision.sources,
        isNewest: open !== null && input.at > open.lastMissedAt,
      });
      outcome = 'appended';
    }
    const inserted = await this.repo.insertEvent({
      callbackId,
      kind: 'missed',
      at: input.at,
      source: input.source,
      callId: input.callId,
    });
    if (!inserted) throw new DuplicateCallError();
    return { outcome, callbackId };
  }

  @Transactional()
  async applyConversation(
    input: ConversationInput,
    minTalkSeconds: number,
  ): Promise<{ outcome: ApplyOutcome; callbackId: number | null }> {
    if (
      input.callId &&
      ((await this.repo.eventExists('resolved', input.callId)) ||
        (await this.repo.eventExists('short_conversation', input.callId)))
    ) {
      return { outcome: 'skipped', callbackId: null };
    }
    const open = await this.repo.findOpenForUpdate(input.phone);
    const decision = decideConversation(
      { direction: input.direction, endedAt: input.endedAt, talkSeconds: input.talkSeconds },
      open,
      minTalkSeconds,
    );
    if (decision.action === 'ignore' || !open) return { outcome: 'skipped', callbackId: null };

    if (decision.action === 'resolve') {
      const inserted = await this.repo.insertEvent({
        callbackId: open.id,
        kind: 'resolved',
        at: input.endedAt,
        callId: input.callId,
        extension: input.extension,
        talkSeconds: input.talkSeconds,
      });
      if (!inserted) throw new DuplicateCallError();
      await this.repo.updateCallback(open.id, {
        status: 'resolved',
        closedAt: input.endedAt,
        closedByLabel: input.extension ? `ext ${input.extension}` : 'system',
        closedByUserId: null,
        closeMethod: 'conversation',
        resolutionType: decision.resolutionType satisfies CallbackResolutionType,
        resolvedCallId: input.callId,
        resolvedExtension: input.extension,
        resolvedTalkSeconds: input.talkSeconds,
      });
      return { outcome: 'resolved', callbackId: open.id };
    }

    // Too short to count. An answered-but-short call back is a failed attempt; a short inbound is just noted.
    const inserted = await this.repo.insertEvent({
      callbackId: open.id,
      kind: 'short_conversation',
      at: input.endedAt,
      callId: input.callId,
      extension: input.extension,
      talkSeconds: input.talkSeconds,
    });
    if (!inserted) throw new DuplicateCallError();
    if (input.direction === 'outbound') {
      await this.repo.incrementOutboundAttempts(open.id, {
        at: input.endedAt,
        extension: input.extension,
        cause: 'short_call',
      });
    }
    return { outcome: 'short', callbackId: open.id };
  }

  @Transactional()
  async applyOutboundFailure(
    input: OutboundFailureInput,
  ): Promise<{ outcome: ApplyOutcome; callbackId: number | null }> {
    if (input.callId && (await this.repo.eventExists('outbound_failed', input.callId))) {
      return { outcome: 'skipped', callbackId: null };
    }
    const open = await this.repo.findOpenForUpdate(input.phone);
    if (!open || decideOutboundFailure(input.at, open) === 'ignore') return { outcome: 'skipped', callbackId: null };
    const inserted = await this.repo.insertEvent({
      callbackId: open.id,
      kind: 'outbound_failed',
      at: input.at,
      callId: input.callId,
      extension: input.extension,
      cause: input.cause,
    });
    if (!inserted) throw new DuplicateCallError();
    await this.repo.incrementOutboundAttempts(open.id, {
      at: input.at,
      extension: input.extension,
      cause: input.cause,
    });
    return { outcome: 'attempt', callbackId: open.id };
  }

  // ------------------------------------------------------------ queries

  todayWindow(now = new Date()): DayWindow {
    return dayBounds(businessDate(now, BUSINESS_TIMEZONE), BUSINESS_TIMEZONE);
  }

  windowFor(date: CallbackListQuery['date'], now = new Date()): DayWindow | null {
    if (date === 'all') return null;
    if (date === 'today') return this.todayWindow(now);
    return dayBounds(date, BUSINESS_TIMEZONE);
  }

  async list(q: CallbackListQuery, user: SessionUser): Promise<CallbackListResponse> {
    const window = this.windowFor(q.date);
    const today = this.todayWindow();
    const [{ items, total }, counts] = await Promise.all([
      this.repo.list(q, window, today, user.id),
      this.repo.counts(q, window, user.id),
    ]);
    return { items, total, counts, page: q.page, pageSize: q.pageSize };
  }

  async details(id: number): Promise<CallbackDetails> {
    const [callback] = await this.repo.getMany([id], this.todayWindow());
    if (!callback) throw new NotFoundException('Callback not found');
    return { callback, events: await this.repo.events(id) };
  }

  // ------------------------------------------------------------ manual actions (audited)

  async close(id: number, outcome: 'resolved' | 'dismissed', reason: string, user: SessionUser): Promise<Callback> {
    await this.closeTx(id, outcome, reason, user);
    return this.publishOne(id);
  }

  @Transactional()
  private async closeTx(
    id: number,
    outcome: 'resolved' | 'dismissed',
    reason: string,
    user: SessionUser,
  ): Promise<void> {
    const cb = await this.repo.findByIdForUpdate(id);
    if (!cb) throw new NotFoundException('Callback not found');
    if (cb.status !== 'pending') throw new ConflictException('Callback is already closed');
    const now = new Date();
    await this.repo.updateCallback(id, {
      status: outcome,
      closedAt: now,
      closedByUserId: user.id,
      closedByLabel: user.username,
      closeMethod: 'manual',
      resolutionType: null,
      closeReason: reason,
    });
    await this.repo.insertEvent({
      callbackId: id,
      kind: outcome === 'resolved' ? 'resolved' : 'dismissed',
      at: now,
      text: reason,
      actorUserId: user.id,
      actorLabel: user.username,
    });
    await this.audit.record(outcome === 'resolved' ? 'callbacks.resolve_manual' : 'callbacks.dismiss', {
      target: `callback:${id}`,
      details: { phone: cb.phone, reason },
    });
  }

  async dismissAll(reason: string, date: CallbackListQuery['date'], user: SessionUser): Promise<number> {
    const ids = await this.dismissAllTx(reason, date, user);
    await this.publish(ids);
    return ids.length;
  }

  @Transactional()
  private async dismissAllTx(reason: string, date: CallbackListQuery['date'], user: SessionUser): Promise<number[]> {
    const ids = await this.repo.pendingIds(this.windowFor(date));
    const now = new Date();
    for (const id of ids) {
      await this.repo.updateCallback(id, {
        status: 'dismissed',
        closedAt: now,
        closedByUserId: user.id,
        closedByLabel: user.username,
        closeMethod: 'manual',
        closeReason: reason,
      });
      await this.repo.insertEvent({
        callbackId: id,
        kind: 'dismissed',
        at: now,
        text: reason,
        actorUserId: user.id,
        actorLabel: user.username,
      });
    }
    await this.audit.record('callbacks.dismiss_all', {
      target: 'callbacks',
      details: { date, reason, count: ids.length, ids },
    });
    return ids;
  }

  async addNote(id: number, text: string, user: SessionUser): Promise<Callback> {
    await this.addNoteTx(id, text, user);
    return this.publishOne(id);
  }

  @Transactional()
  private async addNoteTx(id: number, text: string, user: SessionUser): Promise<void> {
    const cb = await this.repo.findByIdForUpdate(id);
    if (!cb) throw new NotFoundException('Callback not found');
    await this.repo.insertEvent({
      callbackId: id,
      kind: 'note',
      at: new Date(),
      text,
      actorUserId: user.id,
      actorLabel: user.username,
    });
    await this.repo.updateCallback(id, {});
    await this.audit.record('callbacks.note', { target: `callback:${id}`, details: { text } });
  }

  async assign(id: number, userId: number | null, user: SessionUser): Promise<Callback> {
    await this.assignTx(id, userId, user);
    return this.publishOne(id);
  }

  @Transactional()
  private async assignTx(id: number, userId: number | null, actor: SessionUser): Promise<void> {
    const cb = await this.repo.findByIdForUpdate(id);
    if (!cb) throw new NotFoundException('Callback not found');
    if (!hasRoleAtLeast(actor.role, 'admin')) {
      // Operators may take a callback themselves or release their own — never assign other people.
      const takes = userId === actor.id && (cb.assignedUserId === null || cb.assignedUserId === actor.id);
      const releases = userId === null && cb.assignedUserId === actor.id;
      if (!takes && !releases) throw new ForbiddenException('Operators can only take or release callbacks themselves');
    }
    if (cb.status !== 'pending') throw new ConflictException('Callback is already closed');
    const target = userId === null ? null : await this.repo.userExists(userId);
    if (userId !== null && !target) throw new NotFoundException('User not found');
    await this.repo.updateCallback(id, { assignedUserId: userId, assignedAt: userId === null ? null : new Date() });
    await this.repo.insertEvent({
      callbackId: id,
      kind: 'assigned',
      at: new Date(),
      text: target?.username ?? null,
      actorUserId: actor.id,
      actorLabel: actor.username,
    });
    await this.audit.record('callbacks.assign', {
      target: `callback:${id}`,
      details: { userId, previous: cb.assignedUserId },
    });
  }

  // ------------------------------------------------------------ realtime

  async publish(ids: readonly number[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    try {
      for (let i = 0; i < unique.length; i += 200) {
        const items = await this.repo.getMany(unique.slice(i, i + 200), this.todayWindow());
        this.realtime.broadcast('callbacks.updated', { items });
      }
    } catch (err) {
      this.logger.warn(`callbacks.updated broadcast failed: ${String(err)}`);
    }
  }

  private async publishOne(id: number): Promise<Callback> {
    const [cb] = await this.repo.getMany([id], this.todayWindow());
    if (!cb) throw new NotFoundException('Callback not found');
    this.realtime.broadcast('callbacks.updated', { items: [cb] });
    return cb;
  }
}
