import type { LiveOperator } from '@cc/shared';

/**
 * What the presence log records about an operator phone (docs/rewrite/METRICS.md §10.1). Pure: no Nest, no DB.
 *  - offline: the phone is not registered (SIP);
 *  - online: registered and taking queue calls (idle, ringing or talking);
 *  - paused: registered and paused in the queue (talking during a pause stays `paused`).
 */
export const PRESENCE_STATES = ['offline', 'online', 'paused'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

export interface PresenceSample {
  state: PresenceState;
  /** Only for `paused`. */
  reason: string | null;
}

/** Reasons are free text from the pause form (≤ 64 chars); blank = no reason. */
export function normalizeReason(reason: string | null | undefined): string | null {
  const r = reason?.trim().replace(/\s+/g, ' ');
  return r ? r.slice(0, 64) : null;
}

/**
 * The live board's operator (LiveStore projection) → logged state. The live presence has one precedence
 * (talking > ringing > offline > paused > idle): a phone that talks or rings is reachable even before its
 * registration is known, so it counts as online — or paused, if the queue pause is on.
 */
export function sampleOf(op: Pick<LiveOperator, 'presence' | 'paused' | 'pauseReason'>): PresenceSample {
  switch (op.presence) {
    case 'offline':
      return { state: 'offline', reason: null };
    case 'paused':
      return { state: 'paused', reason: normalizeReason(op.pauseReason) };
    case 'idle':
      return { state: 'online', reason: null };
    default: // talking, ringing
      return op.paused
        ? { state: 'paused', reason: normalizeReason(op.pauseReason) }
        : { state: 'online', reason: null };
  }
}

export interface OpenInterval extends PresenceSample {
  id: string;
  extension: string;
}

export interface PresenceDiff {
  /** Open intervals that end now. */
  close: OpenInterval[];
  /** New intervals that start now. */
  open: Array<PresenceSample & { extension: string }>;
}

const same = (a: PresenceSample, b: PresenceSample) => a.state === b.state && a.reason === b.reason;

/**
 * Compare the open intervals with the current samples. A phone that disappeared from the live state is closed and
 * gets no new row (unknown, not offline); a changed state (or pause reason) closes the old interval and opens a new
 * one.
 */
export function diffPresence(
  open: ReadonlyMap<string, OpenInterval>,
  current: ReadonlyMap<string, PresenceSample>,
): PresenceDiff {
  const diff: PresenceDiff = { close: [], open: [] };
  for (const [ext, interval] of open) {
    const now = current.get(ext);
    if (!now || !same(interval, now)) diff.close.push(interval);
  }
  for (const [ext, sample] of current) {
    const interval = open.get(ext);
    if (!interval || !same(interval, sample)) diff.open.push({ extension: ext, ...sample });
  }
  diff.close.sort((a, b) => a.extension.localeCompare(b.extension, undefined, { numeric: true }));
  diff.open.sort((a, b) => a.extension.localeCompare(b.extension, undefined, { numeric: true }));
  return diff;
}
