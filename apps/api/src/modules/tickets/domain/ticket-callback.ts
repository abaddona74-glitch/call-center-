import { CALLBACK_MIN_TALK_SECONDS, type CallAttemptStatus, type CallbackOutcome } from '@cc/shared';

/**
 * Callback step rules (pure). An attempt is created when the operator presses "call" (AMI Originate from
 * their own extension to the ticket's number). AMI call events confirm it:
 *   Answered (outbound, same extension + number, shortly after) → bound to that call id;
 *   Ended → connected when answered with talk ≥ CALLBACK_MIN_TALK_SECONDS, else not_connected.
 * The ticket closes when a connected attempt AND the operator's outcome are both there (any order).
 */

/** How long after pressing "call" an AMI event may still belong to the attempt. */
export const ATTEMPT_MATCH_WINDOW_MS = 3 * 60_000;
/** An attempt that never got an Answered/Ended (AMI lost, call never placed) stops blocking after this. */
export const ATTEMPT_STALE_MS = 2 * 3_600_000;

export interface AttemptFacts {
  extension: string | null;
  phone: string | null;
  startedAt: Date;
  callId: string | null;
  status: CallAttemptStatus;
}

export interface CallEventFacts {
  callId: string;
  direction: 'inbound' | 'outbound' | 'internal';
  extension: string | null;
  phone: string | null;
  at: Date;
}

export function isOpenAttempt(a: Pick<AttemptFacts, 'status' | 'startedAt'>, now: Date): boolean {
  return (
    (a.status === 'dialing' || a.status === 'answered') && now.getTime() - a.startedAt.getTime() < ATTEMPT_STALE_MS
  );
}

/**
 * Does an AMI call event belong to this attempt? A bound attempt matches only its own call id.
 * An unbound one matches an outbound call from the same extension to the same number that happened
 * after the button press (small clock skew allowed) and within the window.
 */
export function eventMatchesAttempt(a: AttemptFacts, e: CallEventFacts): boolean {
  if (a.callId) return a.callId === e.callId;
  if (a.status !== 'dialing') return false;
  if (e.direction !== 'outbound' || !e.phone || !e.extension) return false;
  if (e.extension !== a.extension || e.phone !== a.phone) return false;
  const dt = e.at.getTime() - a.startedAt.getTime();
  return dt >= -5_000 && dt <= ATTEMPT_MATCH_WINDOW_MS;
}

export function attemptStatusAfterEnd(
  answered: boolean,
  talkSeconds: number,
  minTalk = CALLBACK_MIN_TALK_SECONDS,
): CallAttemptStatus {
  return answered && talkSeconds >= minTalk ? 'connected' : 'not_connected';
}

export type OutcomeDecision =
  /** close the ticket now */
  | { kind: 'close' }
  /** keep the outcome; close when the running call ends with a confirmed conversation */
  | { kind: 'pending' }
  /** an unsuccessful attempt: counted, the ticket stays in the queue */
  | { kind: 'attempt' }
  | { kind: 'error'; message: string };

export function decideOutcome(attemptStatus: CallAttemptStatus, outcome: CallbackOutcome): OutcomeDecision {
  if (outcome === 'not_reached') return { kind: 'attempt' };
  switch (attemptStatus) {
    case 'connected':
      return { kind: 'close' };
    case 'dialing':
    case 'answered':
      return { kind: 'pending' };
    default:
      return {
        kind: 'error',
        message: `No conversation of at least ${CALLBACK_MIN_TALK_SECONDS} s with this number was confirmed — mark it "not reached" or call again`,
      };
  }
}

/** After the call ended: what to do with an outcome the operator already gave. */
export function decideAfterEnd(
  status: CallAttemptStatus,
  outcome: CallbackOutcome | null,
): 'close' | 'attempt' | 'wait' {
  if (!outcome) return 'wait';
  if (outcome === 'not_reached') return 'attempt';
  return status === 'connected' ? 'close' : 'attempt';
}

/** Callback queue order: citizens who last talked to me first, then the oldest resolution first. */
export function compareCallbackQueue(
  a: { lastContactUserId: number | null; resolvedAt: Date | null; id: number },
  b: { lastContactUserId: number | null; resolvedAt: Date | null; id: number },
  meId: number,
): number {
  const mineA = a.lastContactUserId === meId ? 0 : 1;
  const mineB = b.lastContactUserId === meId ? 0 : 1;
  if (mineA !== mineB) return mineA - mineB;
  const ta = a.resolvedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const tb = b.resolvedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return ta - tb || a.id - b.id;
}
