/**
 * In-process domain events between backend modules (@nestjs/event-emitter).
 * The telephony module publishes call lifecycle events; callbacks, stats, notifications
 * and others subscribe — no module imports another module's service for this.
 *
 *   // publish
 *   this.events.emit(CallEvents.Answered, payload satisfies CallAnsweredEvent);
 *   // subscribe
 *   @OnEvent(CallEvents.Answered) onAnswered(e: CallAnsweredEvent) { ... }
 *
 * Phone numbers are already normalized with normalizeUzPhone() (9-digit national form).
 * Times are ISO-8601 strings with offset.
 */

export const CallEvents = {
  /** A call entered a queue (citizen is waiting). */
  QueueJoined: 'call.queue_joined',
  /** Caller left the queue without being answered. */
  Abandoned: 'call.abandoned',
  /** An operator answered (inbound) or the callee answered (outbound). */
  Answered: 'call.answered',
  /** Call finished (any outcome). */
  Ended: 'call.ended',
  /** Operator's phone rang and the operator did not pick up / rejected. */
  OperatorMissed: 'call.operator_missed',
} as const;

export type CallDirection = 'inbound' | 'outbound' | 'internal';

interface CallEventBase {
  /** Asterisk linkedid (stable id of the whole call). */
  callId: string;
  direction: CallDirection;
  /** Citizen's number, normalized; null for hidden/internal. */
  phone: string | null;
  at: string;
}

export interface CallQueueJoinedEvent extends CallEventBase {
  queue: string;
}

export interface CallAbandonedEvent extends CallEventBase {
  queue: string;
  waitSeconds: number;
}

export interface CallAnsweredEvent extends CallEventBase {
  /** Operator extension that talks to the citizen. */
  extension: string;
}

export type HangupParty = 'client' | 'operator' | 'unknown';

export interface CallEndedEvent extends CallEventBase {
  extension: string | null;
  answered: boolean;
  talkSeconds: number;
  hangupParty: HangupParty;
}

export interface CallOperatorMissedEvent extends CallEventBase {
  extension: string;
  reason: 'no_answer' | 'rejected' | 'busy' | 'unavailable';
}

/** System settings changed: consumers drop caches derived from them and re-publish live views. */
export const SettingsEvents = {
  /** The excluded operators list changed (settings screen or a restart after migrate-legacy). */
  ExcludedOperatorsChanged: 'settings.excluded_operators_changed',
} as const;

export interface ExcludedOperatorsChangedEvent {
  /** The new list, sorted by number. */
  extensions: string[];
}
