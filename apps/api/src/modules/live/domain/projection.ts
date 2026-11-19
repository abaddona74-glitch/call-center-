import {
  type LiveCall,
  type LiveCounters,
  type LiveOperator,
  type LiveQueue,
  type Permission,
  type Role,
  maskPhone,
  telephonyAccess,
} from '@cc/shared';
import { withSeed } from './cdr-seed.js';
import type { LiveStore } from './live-store.js';

/**
 * Read models sent to clients (REST snapshot + WS). Pure functions over the store.
 *
 * Visibility (same for REST and WS):
 *  - `monitor.viewAll` (superuser): everything;
 *  - no `monitor.view` (executive "Mas’ul", observer): nothing — the snapshot and `telephony.*` events are refused;
 *  - operator: the presence board, queues and active calls, but citizen numbers only for the
 *    calls on their own extension (others are masked); no KPI counters.
 */
export interface Viewer {
  role: Role;
  extension: string | null;
  permissions?: readonly Permission[] | null;
}

export const isPrivileged = (v: Viewer) => telephonyAccess(v).seeAll;

const iso = (ms: number) => new Date(ms).toISOString();

/** `hidden`: excluded operators (settings) — left off the board, as legacy getOperatorList did. */
export function projectOperators(
  store: LiveStore,
  now: number,
  hidden: ReadonlySet<string> = new Set(),
): LiveOperator[] {
  const list: LiveOperator[] = [];
  const seeded = store.todaySeed?.operators;
  for (const op of store.operators.values()) {
    if (hidden.has(op.ext)) continue;
    const { presence, channel, call } = store.presenceOf(op, now);
    let current: LiveOperator['call'] = null;
    if (call && (presence === 'talking' || presence === 'ringing')) {
      const talking = presence === 'talking';
      const since = talking
        ? Math.max(channel?.answeredAt ?? 0, call.answeredAt ?? 0) || now
        : (channel?.createdAt ?? call.ringing.get(op.ext) ?? call.stateSince);
      current = {
        callId: call.id,
        direction: call.direction,
        state: talking ? 'talking' : call.direction === 'outbound' ? 'dialing' : 'ringing',
        phone: call.phone,
        since: iso(since),
      };
    }
    list.push({
      extension: op.ext,
      name: op.name ?? `Operator ${op.ext}`,
      presence,
      presenceSince: iso(op.presenceSince),
      registered: op.registered === true,
      ip: op.ip,
      paused: op.paused,
      pauseReason: op.pauseReason,
      call: current,
      queue: op.queue
        ? { callsTaken: op.queue.callsTaken, lastCallAt: op.queue.lastCallAt ? iso(op.queue.lastCallAt) : null }
        : null,
      today: withSeed(op.today, seeded?.get(op.ext)),
    });
  }
  return list.sort((a, b) => Number(a.extension) - Number(b.extension) || a.extension.localeCompare(b.extension));
}

export function projectCalls(store: LiveStore, now: number): LiveCall[] {
  const list: LiveCall[] = [];
  for (const call of store.calls.values()) {
    if (call.channels.size === 0) continue;
    const state = store.callStateOf(call, now);
    list.push({
      id: call.id,
      direction: call.direction,
      state,
      phone: call.phone,
      callerName: call.callerName,
      queue: call.queue,
      extension: call.direction === 'outbound' ? call.originExt : call.talkingExt,
      ringing: [...call.ringing.keys()].sort(),
      startedAt: iso(call.startedAt),
      answeredAt: call.answeredAt ? iso(call.answeredAt) : null,
      stateSince: iso(call.stateSince),
    });
  }
  return list.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function projectQueues(store: LiveStore): LiveQueue[] {
  return [...store.queues.values()]
    .map((q) => ({
      name: q.name,
      strategy: q.strategy,
      completed: q.completed,
      abandoned: q.abandoned,
      members: q.members.size,
      waiting: [...q.waiting.values()]
        .sort((a, b) => a.position - b.position || a.joinedAt - b.joinedAt)
        .map((w) => ({
          callId: w.callId,
          phone: store.calls.get(w.callId)?.phone ?? null,
          position: w.position,
          joinedAt: iso(w.joinedAt),
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Live counters plus the CDR seed of the day (calls before live counting began), when there is one. */
export function projectCounters(store: LiveStore): LiveCounters {
  const c = store.counters;
  const seed = store.todaySeed;
  const s = seed?.counters;
  const inbound = c.inbound + (s?.inbound ?? 0);
  const answered = c.answered + (s?.answered ?? 0);
  return {
    date: c.date,
    since: iso(seed ? seed.from : c.since),
    seededThrough: seed ? iso(seed.through) : null,
    inbound,
    answered,
    abandoned: c.abandoned + (s?.abandoned ?? 0),
    ivrOnly: c.ivrOnly + (s?.ivrOnly ?? 0),
    unanswered: c.unanswered + (s?.unanswered ?? 0),
    answerRate: inbound ? Math.round((answered * 100) / inbound) : 0,
    outbound: c.outbound + (s?.outbound ?? 0),
    outboundAnswered: c.outboundAnswered + (s?.outboundAnswered ?? 0),
    operatorMissed: c.operatorMissed + (s?.operatorMissed ?? 0),
    operatorMissedNoAnswer: c.operatorMissedNoAnswer + (s?.operatorMissedNoAnswer ?? 0),
    operatorMissedRejected: c.operatorMissedRejected + (s?.operatorMissedRejected ?? 0),
    talkSeconds: c.talkSeconds + (s?.talkSeconds ?? 0),
    clientHangups: c.clientHangups,
    operatorHangups: c.operatorHangups,
    unknownHangups: c.unknownHangups + (s?.unknownHangups ?? 0),
    avgWaitSec: answered ? Math.round((c.waitSeconds + (s?.waitSeconds ?? 0)) / answered) : 0,
  };
}

// --- per-viewer redaction --------------------------------------------------------------------

export function operatorsFor(viewer: Viewer, list: LiveOperator[]): LiveOperator[] {
  if (isPrivileged(viewer)) return list;
  return list.map((op) =>
    op.call && op.extension !== viewer.extension
      ? { ...op, call: { ...op.call, phone: maskPhone(op.call.phone) } }
      : op,
  );
}

export function callsFor(viewer: Viewer, list: LiveCall[]): LiveCall[] {
  if (isPrivileged(viewer)) return list;
  return list.map((c) => {
    const own = viewer.extension !== null && (c.extension === viewer.extension || c.ringing.includes(viewer.extension));
    return own ? c : { ...c, phone: maskPhone(c.phone), callerName: null };
  });
}

export function queuesFor(viewer: Viewer, list: LiveQueue[]): LiveQueue[] {
  if (isPrivileged(viewer)) return list;
  return list.map((q) => ({ ...q, waiting: q.waiting.map((w) => ({ ...w, phone: maskPhone(w.phone) })) }));
}
