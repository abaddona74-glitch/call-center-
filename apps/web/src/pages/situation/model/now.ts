import type { SituationTelephony, SituationWorkday } from '@cc/shared';

/**
 * The board's headline telephony figures (docs/rewrite/METRICS.md §10.1), from the same live state the widgets show.
 */
export interface TelephonyNow {
  operators: { online: number; talking: number; ringing: number; idle: number; paused: number; offline: number };
  /** Callers waiting in every queue; the one waiting longest joined at `longestSince`. */
  waiting: number;
  longestSince: string | null;
  /** Conversations with citizens (internal operator-to-operator calls left out). */
  conversations: { total: number; inbound: number; outbound: number };
  /** Inbound calls ringing an operator / outbound calls dialing right now. */
  ringing: number;
}

export function telephonyNow(t: Pick<SituationTelephony, 'operators' | 'calls' | 'queues'>): TelephonyNow {
  const by = (p: string) => t.operators.filter((o) => o.presence === p).length;
  const waiting = t.queues.flatMap((q) => q.waiting);
  const talking = t.calls.filter((c) => c.state === 'talking' && c.direction !== 'internal');
  return {
    operators: {
      online: t.operators.length - by('offline'),
      talking: by('talking'),
      ringing: by('ringing'),
      idle: by('idle'),
      paused: by('paused'),
      offline: by('offline'),
    },
    waiting: waiting.length,
    longestSince: waiting.length ? waiting.map((w) => w.joinedAt).sort()[0] : null,
    conversations: {
      total: talking.length,
      inbound: talking.filter((c) => c.direction === 'inbound').length,
      outbound: talking.filter((c) => c.direction === 'outbound').length,
    },
    ringing: t.calls.filter((c) => c.direction !== 'internal' && (c.state === 'ringing' || c.state === 'dialing'))
      .length,
  };
}

/** A caller waiting this long turns the waiting tile red (the same 3 minutes the talk stopwatches turn amber at). */
export const LONG_WAIT_SEC = 180;

/** How loud the waiting tile is: nobody waits / someone waits / someone has waited 3 minutes or more. */
export function waitLevel(waiting: number, longestSec: number): 'calm' | 'waiting' | 'long' {
  if (waiting === 0) return 'calm';
  return longestSec >= LONG_WAIT_SEC ? 'long' : 'waiting';
}

export type ShiftState = 'working' | 'afterHours' | 'dayOff';

/** Working now? `hhmm` = the current Tashkent wall time "HH:mm" (the calendar's interval is [start, end)). */
export function shiftState(workday: SituationWorkday, hhmm: string): ShiftState {
  if (!workday.working) return 'dayOff';
  return hhmm >= workday.start && hhmm < workday.end ? 'working' : 'afterHours';
}

/** a / b as a whole percent, 0 without a base. */
export const percent = (a: number, b: number) => (b ? Math.round((a * 100) / b) : 0);
