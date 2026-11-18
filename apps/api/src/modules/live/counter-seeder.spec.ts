import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { epochToWall, parseWall } from '../../common/time/business-time.js';
import { type AssembledCall, assembleCalls } from '../../pbx/calls/call-assembler.js';
import type { CdrRow } from '../../pbx/calls/cdr-row.js';
import { TEST_CALENDAR, TEST_DIALPLAN, inbound, outbound } from '../../pbx/calls/testing/cdr-fixtures.js';
import { type CdrCallsSource, CounterSeeder, LATE_CALL_DELAYS_MS, SEED_DAY_GUARD_MS } from './counter-seeder.js';
import { type AmiEvent, LiveStore } from './domain/live-store.js';
import { projectCounters, projectOperators } from './domain/projection.js';

const TZ = 'Asia/Tashkent';
const ms = (wall: string) => parseWall(wall).epochMs;
/** The API (re)starts and connects to AMI at 12:00:00.4 on Tue 2026-11-17. */
const START = ms('2026-11-17 12:00:00') + 400;
const BOUNDARY = ms('2026-11-17 12:00:01');
const DAY_START = ms('2026-11-17 00:00:00');

// The day's CDR (Tashkent wall clock); ids are Asterisk ids "<epoch>.<n>", the same as AMI Linkedid.
const A = inbound({
  at: '2026-11-17 09:10:00',
  caller: '901111111',
  rung: ['103'],
  outcome: 'answered',
  answeredBy: '101',
  talk: 100,
});
const B = inbound({
  at: '2026-11-17 09:40:00',
  caller: '902222222',
  rung: ['101'],
  outcome: 'abandoned',
  abandonAfter: 20,
});
const C = outbound({ at: '2026-11-17 11:00:00', ext: '101', number: '902222222', disposition: 'ANSWERED', talk: 80 });
/** In progress at the restart: IVR 10 s, rings 5 s, then 120 s with operator 103 (ends 12:02:15). */
const X = inbound({
  at: '2026-11-17 11:59:50',
  caller: '903333333',
  outcome: 'answered',
  answeredBy: '103',
  talk: 120,
});
/** Starts after the restart: counted live. */
const L = inbound({ at: '2026-11-17 12:01:00', caller: '904444444', outcome: 'answered', answeredBy: '101', talk: 30 });
const idOf = (rows: CdrRow[]) => rows[0].uniqueid;

/** A PBX whose CDR has the rows "written" so far (Asterisk writes a call's rows when it ends). */
class FakeCdr implements CdrCallsSource {
  enabled = true;
  written: CdrRow[] = [];
  reads: Array<{ from: string; to: string }> = [];
  fail: Error | null = null;
  async callsFromSlices(
    fromMs: number,
    toMs: number,
  ): Promise<{ calls: AssembledCall[]; rows: number; queries: number }> {
    this.reads.push({ from: epochToWall(fromMs, TZ), to: epochToWall(toMs, TZ) });
    if (this.fail) throw this.fail;
    const [from, to] = [epochToWall(fromMs, TZ), epochToWall(toMs, TZ)];
    const rows = this.written.filter((r) => r.calldate >= from && r.calldate < to);
    return { calls: assembleCalls(rows, TEST_DIALPLAN, TEST_CALENDAR), rows: rows.length, queries: 1 };
  }
}

const config = { operatorExtension: /^[0-9]{2,4}$/, timezone: TZ };
const channel = (name: string, uniqueid: string, linkedid: string, extra: Record<string, string> = {}): AmiEvent => ({
  channel: name,
  uniqueid,
  linkedid,
  channelstate: '6',
  calleridnum: '<unknown>',
  calleridname: '<unknown>',
  exten: '',
  context: 'from-internal',
  ...extra,
});
const xTrunk = channel('SIP/712020159-000000a1', idOf(X), idOf(X), { calleridnum: '903333333', context: 'ext-queues' });
const xSip103 = channel('SIP/103-000000a2', `${Math.floor(ms('2026-11-17 12:00:05') / 1000)}.900`, idOf(X), {
  exten: '103',
});
const lTrunk = channel('SIP/712020159-000000b1', idOf(L), idOf(L), {
  channelstate: '4',
  calleridnum: '904444444',
  context: 'from-trunk',
});

function setup() {
  const cdr = new FakeCdr();
  cdr.written.push(...A, ...B, ...C);
  const store = new LiveStore(config, START - 60_000);
  store.setDirectory(
    [
      { extension: '101', name: 'Ali' },
      { extension: '103', name: 'Vali' },
    ],
    START - 60_000,
  );
  const logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const changed = vi.fn();
  const seeder = new CounterSeeder(store, cdr, TZ, logger, changed);
  return { cdr, store, logger, changed, seeder };
}

/** What LiveService does on the first AMI connection: begin, resync channels, then seed. */
async function connect(s: ReturnType<typeof setup>) {
  expect(s.seeder.begin()).toBe(true);
  s.store.resyncChannels(
    [
      { event: 'CoreShowChannel', ...xTrunk, duration: '00:00:10', bridgeid: 'bx' },
      { event: 'CoreShowChannel', ...xSip103, duration: '00:00:00', bridgeid: 'bx' },
    ],
    Date.now(),
  );
  await s.seeder.seed();
}

/** What LiveService.flush does with the store after AMI events. */
const flush = (s: ReturnType<typeof setup>) => s.seeder.ended(s.store.drainSeedSideEnded());

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('CounterSeeder', () => {
  it('seeds the day before the restart, counts later calls live and adds the call in progress once it ends', async () => {
    const s = setup();
    await connect(s);

    expect(s.store.countFrom).toBe(BOUNDARY);
    expect(s.cdr.reads).toEqual([{ from: epochToWall(DAY_START - SEED_DAY_GUARD_MS, TZ), to: '2026-11-17 12:01:00' }]);
    expect(s.changed).toHaveBeenCalledTimes(1);
    expect(s.logger.log).toHaveBeenCalledWith(expect.stringContaining('seeded from the CDR up to 12:00:01: 3 calls'));
    expect(projectCounters(s.store)).toMatchObject({
      since: new Date(DAY_START).toISOString(),
      seededThrough: new Date(BOUNDARY).toISOString(),
      inbound: 2,
      answered: 1,
      abandoned: 1,
      outbound: 1,
      outboundAnswered: 1,
      operatorMissed: 2,
      talkSeconds: 180,
    });

    // L starts after the restart (live); X, in progress at the restart, ends and its rows are written.
    vi.setSystemTime(ms('2026-11-17 12:01:00'));
    s.store.apply({ event: 'Newchannel', ...lTrunk }, Date.now());
    flush(s);
    vi.setSystemTime(ms('2026-11-17 12:02:15'));
    s.store.apply({ event: 'Hangup', ...xSip103, cause: '16' }, Date.now());
    s.store.apply({ event: 'Hangup', ...xTrunk, cause: '16' }, Date.now());
    s.cdr.written.push(...X);
    flush(s);
    expect(s.seeder.pendingLateCalls).toBe(1);
    expect(projectCounters(s.store)).toMatchObject({ inbound: 3, answered: 1 }); // X not counted live

    await vi.advanceTimersByTimeAsync(LATE_CALL_DELAYS_MS[0]);
    expect(s.cdr.reads).toHaveLength(2);
    expect(s.cdr.reads[1].from).toBe('2026-11-17 11:54:50'); // 5 min before X began
    expect(s.seeder.pendingLateCalls).toBe(0);
    expect(s.changed).toHaveBeenCalledTimes(2);
    // A, B, X from the CDR + L live: every call once
    expect(projectCounters(s.store)).toMatchObject({ inbound: 4, answered: 2, talkSeconds: 300, unknownHangups: 3 });
    const op103 = projectOperators(s.store, Date.now()).find((o) => o.extension === '103')!;
    expect(op103.today).toMatchObject({ answered: 1, talkSeconds: 120, missed: 1 });

    // L's own rows later in the CDR are never added: it is on the live side
    s.cdr.written.push(...L);
    s.seeder.ended([{ callId: idOf(L), startedAt: ms('2026-11-17 12:01:00') }]);
    await vi.advanceTimersByTimeAsync(LATE_CALL_DELAYS_MS[0]);
    expect(projectCounters(s.store).inbound).toBe(4);
  });

  it('a call whose rows do not show up is retried, then left out', async () => {
    const s = setup();
    await connect(s);
    s.store.apply({ event: 'Hangup', ...xSip103, cause: '16' }, Date.now());
    s.store.apply({ event: 'Hangup', ...xTrunk, cause: '16' }, Date.now());
    flush(s);
    for (const delay of LATE_CALL_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
    expect(s.cdr.reads).toHaveLength(1 + LATE_CALL_DELAYS_MS.length);
    expect(s.seeder.pendingLateCalls).toBe(0);
    expect(s.logger.debug).toHaveBeenCalledWith(expect.stringContaining('left out'));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(s.cdr.reads).toHaveLength(1 + LATE_CALL_DELAYS_MS.length);
    expect(projectCounters(s.store).inbound).toBe(2);
  });

  it('when the CDR cannot be read, counts live only and says so', async () => {
    const s = setup();
    s.cdr.fail = new Error('PBX database unavailable');
    await connect(s);
    expect(s.logger.warn).toHaveBeenCalledWith(
      "today's counters are live-only (AMI) since 12:00:01: CDR seed failed: PBX database unavailable",
    );
    expect(projectCounters(s.store)).toMatchObject({
      since: new Date(BOUNDARY).toISOString(),
      seededThrough: null,
      inbound: 0,
    });
    s.store.apply({ event: 'Hangup', ...xSip103, cause: '16' }, Date.now());
    s.store.apply({ event: 'Hangup', ...xTrunk, cause: '16' }, Date.now());
    flush(s);
    expect(s.seeder.pendingLateCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(s.cdr.reads).toHaveLength(1);
    // the in-progress call stays out (it began before "since"), but every call seen from now on counts live,
    // even with an id older than the boundary (a PBX clock behind ours)
    expect(s.store.countFrom).toBeNull();
    const old = `${Math.floor(ms('2026-11-17 11:00:00') / 1000)}.5`;
    s.store.apply(
      { event: 'Newchannel', ...channel('SIP/712020159-000000c1', old, old, { channelstate: '4' }) },
      Date.now(),
    );
    s.store.apply({ event: 'Newchannel', ...lTrunk }, Date.now());
    expect(projectCounters(s.store)).toMatchObject({ inbound: 2, unanswered: 0, seededThrough: null });
    // a later AMI reconnect neither restarts the counters nor seeds again
    expect(s.seeder.begin()).toBe(false);
    expect(projectCounters(s.store).inbound).toBe(2);
  });

  it('without a PBX database, counts live only and reads nothing', async () => {
    const s = setup();
    s.cdr.enabled = false;
    await connect(s);
    expect(s.cdr.reads).toEqual([]);
    expect(s.logger.warn).toHaveBeenCalledWith(expect.stringContaining('live-only (AMI) since 12:00:01'));
    expect(projectCounters(s.store).seededThrough).toBeNull();
  });

  it('an AMI reconnect does not move the boundary or seed again', async () => {
    const s = setup();
    await connect(s);
    vi.setSystemTime(START + 3_600_000);
    expect(s.seeder.begin()).toBe(false);
    await s.seeder.seed();
    expect(s.store.countFrom).toBe(BOUNDARY);
    expect(s.cdr.reads).toHaveLength(1);
  });

  it('after midnight the late calls of the previous day are dropped (the new day is counted live)', async () => {
    const s = setup();
    await connect(s);
    s.store.apply({ event: 'Hangup', ...xSip103, cause: '16' }, Date.now());
    s.store.apply({ event: 'Hangup', ...xTrunk, cause: '16' }, Date.now());
    flush(s);
    s.store.tick(ms('2026-11-18 00:00:01'));
    await vi.advanceTimersByTimeAsync(LATE_CALL_DELAYS_MS[0]);
    expect(s.cdr.reads).toHaveLength(1);
    expect(s.seeder.pendingLateCalls).toBe(0);
    expect(projectCounters(s.store)).toMatchObject({ date: '2026-11-18', seededThrough: null, inbound: 0 });
  });
});
