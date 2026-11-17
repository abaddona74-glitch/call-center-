import type {
  CallbackCategory,
  CallbackResolutionType,
  CallbackSource,
  CallbackStatus,
  OutboundFailureCause,
} from '@cc/shared';
import { type WorkingCalendar, businessDate, isWorkingTime } from './working-calendar.js';

/**
 * Callback business rules (pure). Both the live AMI events and the CDR reconciliation go through
 * these functions, so there is one rule set (fixes legacy B36).
 */

/** The state of a callback that the rules need. */
export interface CallbackState {
  id: number;
  status: CallbackStatus;
  firstMissedAt: Date;
  lastMissedAt: Date;
  closedAt: Date | null;
  sources: CallbackSource[];
}

// ---------------------------------------------------------------- missed calls

export interface MissedSourceInput {
  /** When the citizen started calling. */
  startedAt: Date;
  /** Some operator's phone rang during the call and nobody picked up. */
  operatorRang: boolean;
  /** The PBX played its "outside working hours" announcement. */
  ivrAfterHours?: boolean;
  calendar: WorkingCalendar;
}

/**
 * after_hours wins (the citizen could not have been answered), then operator_missed
 * (the call reached an operator who did not pick up), otherwise abandoned (left while waiting).
 */
export function deriveMissedSource({
  startedAt,
  operatorRang,
  ivrAfterHours,
  calendar,
}: MissedSourceInput): CallbackSource {
  if (ivrAfterHours || !isWorkingTime(startedAt, calendar)) return 'after_hours';
  return operatorRang ? 'operator_missed' : 'abandoned';
}

export function mergeSources(existing: readonly CallbackSource[], added: CallbackSource): CallbackSource[] {
  return existing.includes(added) ? [...existing] : [...existing, added];
}

export type MissedDecision =
  /** Open a new callback. */
  | { action: 'create' }
  /** Count the call as another attempt on the open callback. */
  | { action: 'append'; callbackId: number; firstMissedAt: Date; lastMissedAt: Date; sources: CallbackSource[] }
  /** The call happened before the citizen's last callback was closed — it was already handled. */
  | { action: 'skip'; reason: 'before_last_close' };

/**
 * A missed call never resurrects a closed callback (legacy rule kept), and never changes the
 * opening source of an open one — new sources are added to `sources` (fixes legacy B7/B8).
 */
export function decideMissed(
  missed: { at: Date; source: CallbackSource },
  open: CallbackState | null,
  lastClosed: Pick<CallbackState, 'closedAt'> | null,
): MissedDecision {
  if (open) {
    return {
      action: 'append',
      callbackId: open.id,
      firstMissedAt: missed.at < open.firstMissedAt ? missed.at : open.firstMissedAt,
      lastMissedAt: missed.at > open.lastMissedAt ? missed.at : open.lastMissedAt,
      sources: mergeSources(open.sources, missed.source),
    };
  }
  if (lastClosed?.closedAt && missed.at.getTime() <= lastClosed.closedAt.getTime()) {
    return { action: 'skip', reason: 'before_last_close' };
  }
  return { action: 'create' };
}

// ---------------------------------------------------------------- conversations

export interface ConversationFact {
  direction: 'inbound' | 'outbound';
  /** When the conversation ended. */
  endedAt: Date;
  talkSeconds: number;
}

export type ConversationDecision =
  /** A real conversation — the callback is done. */
  | { action: 'resolve'; resolutionType: CallbackResolutionType }
  /** Answered but too short to count (hello/hang-up, voicemail). Kept on the timeline. */
  | { action: 'short' }
  | { action: 'ignore'; reason: 'no_open_callback' | 'older_than_last_missed_call' };

/**
 * Only a conversation of at least `minTalkSeconds` resolves a callback (fixes legacy B55: pickup or
 * any bridge used to resolve). A conversation that ended before the latest missed call cannot close
 * the newer request (fixes legacy B19).
 */
export function decideConversation(
  conv: ConversationFact,
  open: CallbackState | null,
  minTalkSeconds: number,
): ConversationDecision {
  if (!open || open.status !== 'pending') return { action: 'ignore', reason: 'no_open_callback' };
  if (conv.endedAt.getTime() < open.lastMissedAt.getTime()) {
    return { action: 'ignore', reason: 'older_than_last_missed_call' };
  }
  if (conv.talkSeconds >= minTalkSeconds) {
    return { action: 'resolve', resolutionType: resolutionTypeFor(conv.direction) };
  }
  return { action: 'short' };
}

export function resolutionTypeFor(direction: 'inbound' | 'outbound'): CallbackResolutionType {
  return direction === 'outbound' ? 'operator_outbound' : 'client_inbound';
}

// ---------------------------------------------------------------- outbound attempts

/** An operator's failed call back attempt counts only if made after the citizen's first missed call (B20). */
export function decideOutboundFailure(attemptAt: Date, open: CallbackState | null): 'record' | 'ignore' {
  if (!open || open.status !== 'pending') return 'ignore';
  return attemptAt.getTime() >= open.firstMissedAt.getTime() ? 'record' : 'ignore';
}

/** CDR `disposition` of an unanswered outbound call → cause shown to operators. */
export function causeFromDisposition(disposition: string): OutboundFailureCause {
  switch (disposition.trim().toUpperCase()) {
    case 'BUSY':
      return 'busy';
    case 'FAILED':
    case 'CONGESTION':
      return 'unavailable';
    default:
      return 'no_answer';
  }
}

// ---------------------------------------------------------------- presentation

/** UI bucket: pending (nobody tried), unreachable (operators tried and failed), resolved, dismissed. */
export function categoryOf(cb: { status: CallbackStatus; outboundAttempts: number }): CallbackCategory {
  if (cb.status === 'resolved') return 'resolved';
  if (cb.status === 'dismissed') return 'dismissed';
  return cb.outboundAttempts > 0 ? 'unreachable' : 'pending';
}

/** Attempts on a given business day (legacy `today_attempts`, now counted from the event log — B9). */
export function countOnDay(
  events: ReadonlyArray<{ kind: string; at: Date }>,
  kind: string,
  day: string,
  timezone: string,
): number {
  return events.filter((e) => e.kind === kind && businessDate(e.at, timezone) === day).length;
}
