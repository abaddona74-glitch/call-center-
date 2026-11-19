import type { OperatorToday } from '@cc/shared';
import { DateTime } from 'luxon';
import type { AssembledCall } from '../../../pbx/calls/call-assembler.js';
import { operatorStats, summarize } from '../../stats/domain/metrics.js';

/**
 * Today's counters for the calls that started before the API began counting live, from the PBX CDR.
 * Pure: no Nest, no I/O.
 *
 * The CDR side and the live (AMI) side split the day at one boundary — a whole second — and decide which side a call
 * is on the same way: by the epoch in its Asterisk id (`startedBefore`). The id is the AMI Linkedid on the live side
 * and the CDR linkedid (or, without that column, the uniqueid of the caller's channel — the same value) on the CDR
 * side. So a call that was in progress when counting started is counted once: never live, and in the CDR once it ends.
 *
 * The boundary is read on the API clock, the ids carry the PBX clock (both NTP-synced in production). A PBX clock
 * behind ours only sends the first seconds' live calls through the CDR (they are added when they end); one ahead of
 * ours loses the calls begun in that gap just before the connection.
 *
 * Numbers come from the statistics page's own definitions (`summarize` / `operatorStats`, docs/rewrite/METRICS.md);
 * nothing is counted here. Both are sums over calls, so seeds of disjoint call sets add up (`addCallsToSeed`).
 */

/** The live counters the CDR can give. Hangup sides other than "unknown" are AMI-only. */
export interface SeedCounters {
  inbound: number;
  answered: number;
  abandoned: number;
  ivrOnly: number;
  unanswered: number;
  outbound: number;
  outboundAnswered: number;
  operatorMissed: number;
  operatorMissedNoAnswer: number;
  operatorMissedRejected: number;
  talkSeconds: number;
  unknownHangups: number;
}

export interface CounterSeed {
  /** Tashkent date (YYYY-MM-DD) the seed is for. */
  date: string;
  /** Start of that day (epoch ms). */
  from: number;
  /** The boundary: calls that started before it (epoch ms, whole second) are in the seed. */
  through: number;
  counters: SeedCounters;
  /** ext → today's figures from the CDR (`clientHangups`/`operatorHangups` stay 0). */
  operators: Map<string, OperatorToday>;
  /** Calls already in the seed, so that adding late calls never counts one twice. */
  callIds: Set<string>;
}

const ASTERISK_ID = /(?:^|-)(\d{9,11})\.\d+$/;

/** Start of the call from an Asterisk id "<epoch seconds>.<n>" (optionally "<systemname>-" first), or null. */
export function callIdEpochMs(id: string): number | null {
  const m = ASTERISK_ID.exec(id);
  return m ? Number(m[1]) * 1000 : null;
}

/**
 * The call started before `boundary` (epoch ms, a whole second): by its id when that is an Asterisk id, otherwise
 * by `startMs` (the CDR calldate / when AMI first saw it).
 */
export function startedBefore(boundary: number, id: string, startMs: number): boolean {
  return (callIdEpochMs(id) ?? startMs) < boundary;
}

/** Midnight of a Tashkent date, epoch ms. */
export function dayStartMs(date: string, timezone: string): number {
  return DateTime.fromISO(date, { zone: timezone }).startOf('day').toMillis();
}

export const emptyOperatorToday = (): OperatorToday => ({
  answered: 0,
  outbound: 0,
  outboundAttempts: 0,
  missed: 0,
  missedNoAnswer: 0,
  missedRejected: 0,
  transfersIn: 0,
  transfersOut: 0,
  talkSeconds: 0,
  clientHangups: 0,
  operatorHangups: 0,
});

export function emptySeed(date: string, from: number, through: number): CounterSeed {
  return {
    date,
    from,
    through,
    counters: {
      inbound: 0,
      answered: 0,
      abandoned: 0,
      ivrOnly: 0,
      unanswered: 0,
      outbound: 0,
      outboundAnswered: 0,
      operatorMissed: 0,
      operatorMissedNoAnswer: 0,
      operatorMissedRejected: 0,
      talkSeconds: 0,
      unknownHangups: 0,
    },
    operators: new Map(),
    callIds: new Set(),
  };
}

export interface AddCallsOptions {
  /** Leave these calls out (still in progress: their CDR rows are missing or incomplete). */
  skip?: (callId: string) => boolean;
  /** Add only these calls (late calls that ended after the seed). */
  only?: ReadonlySet<string>;
}

/**
 * A new seed = `seed` + the calls of its day that started before its boundary and are not in it yet.
 * `calls` are assembled CDR calls (`assembleCalls`); calls of other days and later calls are ignored.
 */
export function addCallsToSeed(
  seed: CounterSeed,
  calls: readonly AssembledCall[],
  opts: AddCallsOptions = {},
): { seed: CounterSeed; added: string[] } {
  const picked = calls.filter(
    (c) =>
      c.date === seed.date &&
      startedBefore(seed.through, c.id, c.startEpochMs) &&
      !seed.callIds.has(c.id) &&
      (!opts.only || opts.only.has(c.id)) &&
      !opts.skip?.(c.id),
  );
  if (picked.length === 0) return { seed, added: [] };

  const s = summarize(picked, { from: seed.date, to: seed.date, scope: 'all' });
  const rows = operatorStats(picked, { scope: 'all', names: new Map(), groupOf: () => null });
  const c = seed.counters;
  const counters: SeedCounters = {
    inbound: c.inbound + s.inbound.offered,
    answered: c.answered + s.inbound.answered,
    abandoned: c.abandoned + s.inbound.abandoned,
    ivrOnly: c.ivrOnly + s.inbound.ivr,
    // every unanswered status: abandoned, ivr and after_hours
    unanswered: c.unanswered + s.inbound.offered - s.inbound.answered,
    outbound: c.outbound + s.outbound.attempts,
    outboundAnswered: c.outboundAnswered + s.outbound.connected,
    operatorMissed: c.operatorMissed + rows.reduce((n, r) => n + r.missed, 0),
    operatorMissedNoAnswer: c.operatorMissedNoAnswer + rows.reduce((n, r) => n + r.missedNoAnswer, 0),
    operatorMissedRejected: c.operatorMissedRejected + rows.reduce((n, r) => n + r.missedRejected, 0),
    talkSeconds: c.talkSeconds + s.talk.totalSec,
    // the CDR does not say who hung up (METRICS.md §1.4: hangupBy = unknown)
    unknownHangups: c.unknownHangups + s.inbound.answered + s.outbound.connected,
  };

  const operators = new Map(seed.operators);
  for (const r of rows) {
    const t = operators.get(r.ext) ?? emptyOperatorToday();
    operators.set(r.ext, {
      ...t,
      answered: t.answered + r.answered,
      outbound: t.outbound + r.outbound,
      outboundAttempts: t.outboundAttempts + r.outboundAttempts,
      missed: t.missed + r.missed,
      missedNoAnswer: t.missedNoAnswer + r.missedNoAnswer,
      missedRejected: t.missedRejected + r.missedRejected,
      transfersIn: t.transfersIn + r.transferredIn,
      transfersOut: t.transfersOut + r.transferredOut,
      talkSeconds: t.talkSeconds + r.talkSec,
    });
  }

  const added = picked.map((p) => p.id);
  return {
    seed: { ...seed, counters, operators, callIds: new Set([...seed.callIds, ...added]) },
    added,
  };
}

/** Live figures of one operator plus the CDR seed's. */
export function withSeed(today: OperatorToday, seeded: OperatorToday | undefined): OperatorToday {
  if (!seeded) return { ...today };
  return {
    answered: today.answered + seeded.answered,
    outbound: today.outbound + seeded.outbound,
    outboundAttempts: today.outboundAttempts + seeded.outboundAttempts,
    missed: today.missed + seeded.missed,
    missedNoAnswer: today.missedNoAnswer + seeded.missedNoAnswer,
    missedRejected: today.missedRejected + seeded.missedRejected,
    transfersIn: today.transfersIn + seeded.transfersIn,
    transfersOut: today.transfersOut + seeded.transfersOut,
    talkSeconds: today.talkSeconds + seeded.talkSeconds,
    clientHangups: today.clientHangups + seeded.clientHangups,
    operatorHangups: today.operatorHangups + seeded.operatorHangups,
  };
}
