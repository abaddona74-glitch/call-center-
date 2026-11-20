/**
 * Telephony right now for the live situation board (docs/rewrite/METRICS.md §10.1). Pure: no Nest, no I/O.
 *
 * Built from the live module's own projections (`projectOperators` / `projectCalls` / `projectQueues` /
 * `projectCounters`) WITHOUT the per-viewer redaction: the board's viewers (`situation.view`) see citizen numbers in
 * full (owner, 19.11.2026). Operator phone/PC addresses and the AMI error text (PBX host and port) are dropped —
 * the board does not need them.
 */
import type { AmiStatus, SituationTelephony, SituationWorkday } from '@cc/shared';
import type { LiveStore } from '../../live/domain/live-store.js';
import { projectCalls, projectCounters, projectOperators, projectQueues } from '../../live/domain/projection.js';

export interface SituationTelephonyInput {
  store: LiveStore;
  now: number;
  /** Excluded operators (settings): off the board, as on the live dashboard. */
  hidden: ReadonlySet<string>;
  /** Operator photos: extension → URL. */
  photos?: ReadonlyMap<string, string>;
  ami: AmiStatus;
  workday: SituationWorkday;
}

/** Everything but `serverTime`, so two builds with the same content compare equal (`telephonyKey`). */
export type SituationTelephonyState = Omit<SituationTelephony, 'serverTime'>;

export function buildSituationTelephony(input: SituationTelephonyInput): SituationTelephonyState {
  const { store, now } = input;
  return {
    operators: projectOperators(store, now, input.hidden, input.photos).map((o) => ({ ...o, ip: null })),
    calls: projectCalls(store, now),
    queues: projectQueues(store),
    counters: projectCounters(store),
    ami: { ...input.ami, lastError: null },
    workday: input.workday,
  };
}

/** Change detection for the WS push: equal keys = nothing on the board changed. */
export function telephonyKey(state: SituationTelephonyState): string {
  return JSON.stringify(state);
}
