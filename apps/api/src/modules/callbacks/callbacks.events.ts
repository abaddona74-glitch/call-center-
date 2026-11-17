import { normalizeUzPhone } from '@cc/shared';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import {
  type CallAbandonedEvent,
  type CallAnsweredEvent,
  type CallEndedEvent,
  CallEvents,
  type CallOperatorMissedEvent,
  type CallQueueJoinedEvent,
} from '../../common/events/domain-events.js';
import { CallbacksService } from './callbacks.service.js';
import { deriveMissedSource } from './domain/callback-rules.js';
import { LiveCallTracker } from './domain/live-call-tracker.js';

/**
 * Subscribes to the call lifecycle published by the telephony (AMI) module and turns it into
 * callback changes. Failures are logged, never thrown back into the emitter.
 */
@Injectable()
export class CallbacksEventsListener {
  private readonly logger = new Logger(CallbacksEventsListener.name);
  readonly tracker = new LiveCallTracker();

  constructor(private readonly callbacks: CallbacksService) {}

  @OnEvent(CallEvents.QueueJoined)
  onQueueJoined(e: CallQueueJoinedEvent): void {
    const at = this.time(e.at);
    if (at) this.tracker.started(e.callId, at);
  }

  @OnEvent(CallEvents.OperatorMissed)
  onOperatorMissed(e: CallOperatorMissedEvent): void {
    const at = this.time(e.at);
    if (at && e.direction === 'inbound') this.tracker.operatorRang(e.callId, e.extension, at);
  }

  @OnEvent(CallEvents.Answered)
  onAnswered(e: CallAnsweredEvent): void {
    const at = this.time(e.at);
    if (at) this.tracker.started(e.callId, at);
  }

  @OnEvent(CallEvents.Abandoned)
  async onAbandoned(e: CallAbandonedEvent): Promise<void> {
    await this.safely('abandoned', async () => {
      const phone = normalizeUzPhone(e.phone);
      const at = this.time(e.at);
      if (!phone || !at || e.direction !== 'inbound') return;
      const known = this.tracker.get(e.callId);
      const startedAt = known?.startedAt ?? new Date(at.getTime() - Math.max(0, e.waitSeconds) * 1000);
      const source = deriveMissedSource({
        startedAt,
        operatorRang: known?.operatorRang ?? false,
        calendar: await this.callbacks.calendar(),
      });
      await this.callbacks.recordMissed({ callId: e.callId, phone, at: startedAt, source });
    });
  }

  @OnEvent(CallEvents.Ended)
  async onEnded(e: CallEndedEvent): Promise<void> {
    const known = this.tracker.get(e.callId);
    this.tracker.forget(e.callId);
    await this.safely('ended', async () => {
      const phone = normalizeUzPhone(e.phone);
      const at = this.time(e.at);
      if (!phone || !at || e.direction === 'internal') return;

      if (e.answered) {
        await this.callbacks.recordConversation({
          callId: e.callId,
          phone,
          direction: e.direction,
          extension: e.extension,
          endedAt: at,
          talkSeconds: Math.max(0, Math.round(e.talkSeconds)),
        });
        return;
      }

      if (e.direction === 'outbound') {
        await this.callbacks.recordOutboundFailure({
          callId: e.callId,
          phone,
          extension: e.extension,
          at,
          cause: 'no_answer',
        });
        return;
      }

      // Inbound, nobody answered. If the queue already reported the abandon, this is a no-op (same callId).
      const startedAt = known?.startedAt ?? at;
      const source = deriveMissedSource({
        startedAt,
        operatorRang: known?.operatorRang ?? false,
        calendar: await this.callbacks.calendar(),
      });
      await this.callbacks.recordMissed({ callId: e.callId, phone, at: startedAt, source });
    });
  }

  @Interval(10 * 60_000)
  sweep(): void {
    const dropped = this.tracker.sweep();
    if (dropped > 0) this.logger.debug(`dropped ${dropped} stale tracked calls`);
  }

  private time(raw: string): Date | null {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private async safely(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(
        `call.${what} handling failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    }
  }
}
