import {
  type LiveCall,
  type LiveCounters,
  type LiveOperator,
  type LiveQueue,
  type Role,
  maskPhone,
  telephonyAccess,
} from '@cc/shared';
import type { LiveStore } from './live-store.js';

/**
 * Read models sent to clients (REST snapshot + WS). Pure functions over the store.
 *
 * Visibility (same for REST and WS):
 *  - admin/superuser: everything;
 *  - operator: the presence board, queues and active calls, but citizen numbers only for the
 *    calls on their own extension (others are masked); no KPI counters.
 */
export interface Viewer {
  role: Role;
  extension: string | null;
}

export const isPrivileged = (v: Viewer) => telephonyAccess(v.role).seeAll;

const iso = (ms: number) => new Date(ms).toISOString();

export function projectOperators(store: LiveStore, now: number): LiveOperator[] {
  const list: LiveOperator[] = [];
  for (const op of store.operators.values()) {
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
      today: { ...op.today },
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

export function projectCounters(store: LiveStore): LiveCounters {
  const c = store.counters;
  return {
    date: c.date,
    since: iso(c.since),
    inbound: c.inbound,
    answered: c.answered,
    abandoned: c.abandoned,
    ivrOnly: c.ivrOnly,
    unanswered: c.unanswered,
    answerRate: c.inbound ? Math.round((c.answered * 100) / c.inbound) : 0,
    outbound: c.outbound,
    outboundAnswered: c.outboundAnswered,
    operatorMissed: c.operatorMissed,
    talkSeconds: c.talkSeconds,
    clientHangups: c.clientHangups,
    operatorHangups: c.operatorHangups,
    unknownHangups: c.unknownHangups,
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
