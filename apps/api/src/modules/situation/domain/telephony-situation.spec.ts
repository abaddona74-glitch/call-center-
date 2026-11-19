import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AmiStatus, SituationWorkday } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { type AmiEvent, LiveStore } from '../../live/domain/live-store.js';
import { operatorsFor, projectCounters, queuesFor } from '../../live/domain/projection.js';
import { buildSituationTelephony, telephonyKey } from './telephony-situation.js';

interface Fixture {
  start: number;
  peers: Record<string, string>[];
  queueStatus: Record<string, string>[];
  events: Array<{ t: number; e: Record<string, string> }>;
}
const FIXTURES = join(import.meta.dirname, '../../live/domain/__fixtures__');
const lower = (e: Record<string, string>): AmiEvent =>
  Object.fromEntries(Object.entries(e).map(([k, v]) => [k.toLowerCase(), v]));

/** A recorded simulator call replayed up to `until` ms after its start (inclusive). */
function storeAt(name: string, until: number) {
  const fx = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Fixture;
  const store = new LiveStore({ operatorExtension: /^[0-9]{2,4}$/, timezone: 'Asia/Tashkent' }, fx.start);
  store.setDirectory([{ extension: '101', name: 'Aziza' }], fx.start);
  store.applyPeers(fx.peers.map(lower), fx.start);
  store.applyQueueStatus(fx.queueStatus.map(lower), fx.start);
  for (const { t, e } of fx.events) if (t <= until) store.apply(lower(e), fx.start + t);
  return { store, start: fx.start, fx };
}

const ami: AmiStatus = {
  enabled: true,
  state: 'disconnected',
  since: '2026-11-17T05:00:00.000Z',
  lastError: 'connect ECONNREFUSED 192.168.0.124:5038',
};
const workday: SituationWorkday = { date: '2026-11-17', working: true, start: '08:00', end: '21:00' };

describe('buildSituationTelephony', () => {
  it('a caller waiting in the queue: full number for the board (an operator would see it masked)', () => {
    const { store, start } = storeAt('queue-answered-client-hangup', 3_300);
    const now = start + 5_000;
    const board = buildSituationTelephony({ store, now, hidden: new Set(), ami, workday });

    const waiting = board.queues.flatMap((q) => q.waiting);
    expect(waiting).toEqual([expect.objectContaining({ phone: '901234567', position: 1 })]);
    const call = board.calls.find((c) => c.direction === 'inbound')!;
    expect(call).toMatchObject({ phone: '901234567', state: 'ringing', ringing: ['101'] });
    expect(board.operators.find((o) => o.extension === '101')).toMatchObject({
      name: 'Aziza',
      presence: 'ringing',
      call: { phone: '901234567', state: 'ringing' },
    });

    // the dashboard's redaction for an operator (no monitor.viewAll) masks the same caller
    const opViewer = { role: 'operator' as const, extension: '103', permissions: ['monitor.view' as const] };
    expect(queuesFor(opViewer, board.queues).flatMap((q) => q.waiting)[0].phone).toBe('90 ••• •• 67');
    expect(operatorsFor(opViewer, board.operators).find((o) => o.extension === '101')!.call!.phone).toBe(
      '90 ••• •• 67',
    );
  });

  it('a conversation in progress: talking operator, call, today’s counters with the average wait', () => {
    const { store, start } = storeAt('queue-answered-client-hangup', 60_000);
    const board = buildSituationTelephony({ store, now: start + 60_000, hidden: new Set(), ami, workday });
    expect(board.operators.find((o) => o.extension === '101')).toMatchObject({
      presence: 'talking',
      call: { phone: '901234567', state: 'talking', direction: 'inbound' },
    });
    expect(board.calls).toEqual([expect.objectContaining({ state: 'talking', extension: '101', phone: '901234567' })]);
    expect(board.queues.flatMap((q) => q.waiting)).toEqual([]);
    expect(board.counters).toEqual(projectCounters(store));
    expect(board.counters).toMatchObject({ inbound: 1, answered: 1, avgWaitSec: 4 });
  });

  it('leaves out operator addresses, the AMI error text and excluded operators', () => {
    const { store, start, fx } = storeAt('queue-answered-client-hangup', 0);
    expect(fx.peers.some((p) => Object.values(p).some((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v)))).toBe(true);
    const board = buildSituationTelephony({ store, now: start, hidden: new Set(['119']), ami, workday });
    expect(board.operators.length).toBeGreaterThan(1);
    for (const o of board.operators) expect(o.ip).toBeNull();
    expect(board.operators.map((o) => o.extension)).not.toContain('119');
    expect(board.ami).toEqual({ ...ami, lastError: null });
    expect(board.workday).toEqual(workday);
    expect(JSON.stringify(board)).not.toContain('192.168.');
  });
});

describe('telephonyKey', () => {
  it('is stable while nothing changes and changes with the board', () => {
    const { store, start } = storeAt('queue-answered-client-hangup', 3_300);
    const build = (now: number) => buildSituationTelephony({ store, now, hidden: new Set(), ami, workday });
    // Stopwatches run in the browser from ISO times, so the passing seconds alone push nothing.
    expect(telephonyKey(build(start + 4_000))).toBe(telephonyKey(build(start + 5_000)));
    const before = telephonyKey(build(start + 5_000));
    store.apply(
      lower({
        Event: 'QueueMemberPause',
        Queue: '2020159',
        Interface: 'SIP/103',
        MemberName: '103',
        Paused: '1',
        PausedReason: 'Tushlik',
      }),
      start + 6_000,
    );
    expect(telephonyKey(build(start + 6_000))).not.toBe(before);
  });
});
