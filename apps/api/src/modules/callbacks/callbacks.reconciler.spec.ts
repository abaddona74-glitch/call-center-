import type { SchedulerRegistry } from '@nestjs/schedule';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import {
  CallbacksReconciler,
  CdrWindowTruncatedError,
  type CdrLegsReader,
  MAX_ROWS_PER_SLICE,
} from './callbacks.reconciler.js';
import type { CallbacksService } from './callbacks.service.js';
import type { CdrLeg } from './domain/cdr-calls.js';
import { formatBusinessDateTime } from './domain/working-calendar.js';

const MIN = 60_000;
const H = 60 * MIN;
const NOW = new Date('2026-11-18T19:00:00+05:00');
const ago = (ms: number, from = NOW) => new Date(from.getTime() - ms);
const local = (d: Date) => formatBusinessDateTime(d, 'Asia/Tashkent');

/** One CDR row; by default an inbound call answered by operator 101 (→ a conversation fact). */
function leg(calldate: Date, over: Partial<CdrLeg> = {}): CdrLeg {
  return {
    calldate: local(calldate),
    src: '998901234567',
    dst: '200',
    dcontext: 'ext-queues',
    channel: 'SIP/712020159-00000001',
    dstchannel: 'Local/101@from-queue-00000001;1',
    lastdata: '',
    disposition: 'ANSWERED',
    duration: 90,
    billsec: 60,
    uniqueid: 'u1',
    linkedid: 'u1',
    ...over,
  };
}

function setup(rows: CdrLeg[] = []) {
  const cdr = { rows, fail: null as Error | null, full: null as string | null };
  const read = vi.fn(async (from: string, to: string, limit: number): Promise<CdrLeg[]> => {
    if (cdr.fail) throw cdr.fail;
    if (cdr.full === from) return Array.from({ length: limit }, () => leg(NOW, { uniqueid: 'flood' }));
    return cdr.rows
      .filter((r) => r.calldate >= from && r.calldate < to)
      .sort((a, b) => a.calldate.localeCompare(b.calldate))
      .slice(0, limit);
  });
  const applied = { missed: [] as string[], conversation: [] as string[], outbound: [] as string[] };
  const callbacks = {
    calendar: () => ({ isWorkingInstant: () => true }),
    settings: async () => ({ minTalkSeconds: 20 }),
    legacyImportedUntil: async () => null,
    applyQuietly: async (run: () => Promise<unknown>) => run(),
    applyMissed: vi.fn(async (input: { callId: string }) => {
      applied.missed.push(input.callId);
      return { outcome: 'created', callbackId: 1 };
    }),
    applyConversation: vi.fn(async (input: { callId: string }) => {
      applied.conversation.push(input.callId);
      return { outcome: 'resolved', callbackId: 2 };
    }),
    applyOutboundFailure: vi.fn(async (input: { callId: string }) => {
      applied.outbound.push(input.callId);
      return { outcome: 'attempt', callbackId: 3 };
    }),
    publish: vi.fn(async () => undefined),
  };
  const config = {
    get: (key: string) => ({ CALLBACKS_RECONCILE_LOOKBACK_HOURS: 48, CALLBACKS_RECONCILE_INTERVAL_SEC: 300 })[key],
  } as unknown as AppConfig;
  const reconciler = new CallbacksReconciler(
    { available: true, read } as unknown as CdrLegsReader,
    callbacks as unknown as CallbacksService,
    config,
    {} as SchedulerRegistry,
  );
  /** [from, to] of every slice read since the last call. */
  const slices = () => {
    const calls = read.mock.calls.map(([from, to]) => [from, to]);
    read.mockClear();
    return calls;
  };
  return { reconciler, cdr, read, slices, applied, callbacks };
}

describe('CallbacksReconciler: window and slices', () => {
  it('startup run reads the whole lookback (plus a 1 h guard) in contiguous 1 h slices', async () => {
    const { reconciler, slices, applied } = setup([leg(ago(2 * H))]);
    const result = await reconciler.tick(NOW);

    const read = slices();
    expect(read).toHaveLength(50); // 48 h + 1 h guard + 1 min skew
    expect(read[0][0]).toBe('2026-11-16 18:00:00');
    expect(read.at(-1)?.[1]).toBe('2026-11-18 19:01:00');
    for (let i = 1; i < read.length; i++) expect(read[i][0]).toBe(read[i - 1][1]);
    expect(applied.conversation).toEqual(['u1']);
    expect(result).toMatchObject({ scannedRows: 1, calls: 1, resolved: 1 });
  });

  it("next tick reads from the previous run's end minus the 2 h overlap (and the 1 h guard before it)", async () => {
    const { reconciler, slices } = setup();
    await reconciler.tick(NOW);
    slices();
    await reconciler.tick(new Date(NOW.getTime() + 5 * MIN));

    const read = slices();
    expect(read[0][0]).toBe('2026-11-18 16:01:00'); // previous end 19:01 − 2 h overlap − 1 h guard
    expect(read.at(-1)?.[1]).toBe('2026-11-18 19:06:00');
    expect(read).toHaveLength(4);
  });

  it('a failed run does not move the window', async () => {
    const { reconciler, cdr, slices } = setup();
    await reconciler.tick(NOW);
    cdr.fail = new Error('PBX gone');
    await expect(reconciler.tick(new Date(NOW.getTime() + 5 * MIN))).rejects.toThrow('PBX gone');
    cdr.fail = null;
    slices();
    await reconciler.tick(new Date(NOW.getTime() + 10 * MIN));
    expect(slices()[0][0]).toBe('2026-11-18 16:01:00'); // still from the startup run's end
  });

  it('a failed startup run leaves the next tick on the whole lookback', async () => {
    const { reconciler, cdr, slices } = setup();
    cdr.fail = new Error('PBX gone');
    await expect(reconciler.tick(NOW)).rejects.toThrow('PBX gone');
    cdr.fail = null;
    slices();
    await reconciler.tick(new Date(NOW.getTime() + 5 * MIN));
    expect(slices()[0][0]).toBe('2026-11-16 18:05:00');
  });

  it('a call whose rows cross a slice boundary is judged whole', async () => {
    // A busy operator at 16:59:50 and the answer at 17:00:10: different 1 h slices, one call.
    const busy = leg(new Date('2026-11-18T16:59:50+05:00'), {
      uniqueid: 'x',
      linkedid: 'x',
      dstchannel: 'Local/104@from-queue-00000002;1',
      disposition: 'BUSY',
      duration: 0,
      billsec: 0,
    });
    const answered = leg(new Date('2026-11-18T17:00:10+05:00'), { uniqueid: 'x', linkedid: 'x' });
    const { reconciler, applied } = setup([busy, answered]);
    await reconciler.tick(NOW);
    expect(applied).toEqual({ missed: [], conversation: ['x'], outbound: [] });
  });

  it('leaves alone a call that started before the window (it is only partly read)', async () => {
    const before = leg(ago(48 * H + 10 * MIN), { uniqueid: 'old', linkedid: 'old' });
    const tail = leg(ago(48 * H - 5 * MIN), {
      uniqueid: 'old',
      linkedid: 'old',
      dstchannel: 'Local/104@from-queue-00000002;1',
      disposition: 'BUSY',
      billsec: 0,
    });
    const { reconciler, applied } = setup([before, tail]);
    const result = await reconciler.tick(NOW);
    expect(applied).toEqual({ missed: [], conversation: [], outbound: [] });
    expect(result).toMatchObject({ scannedRows: 2, calls: 0 });
  });
});

describe('CallbacksReconciler: slice cap', () => {
  it('a full slice: nothing from the run is applied, reading stops, the window does not move', async () => {
    const { reconciler, cdr, slices, applied, callbacks } = setup([
      leg(ago(3 * H)),
      leg(ago(30 * MIN), { uniqueid: 'u2', linkedid: 'u2' }),
    ]);
    cdr.full = '2026-11-18 17:00:00'; // the 17:00–18:00 slice has more than MAX_ROWS_PER_SLICE rows

    const err = await reconciler.tick(NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CdrWindowTruncatedError);
    expect((err as Error).message).toBe(
      `CDR slice 2026-11-18 17:00:00..2026-11-18 18:00:00 has more than ${MAX_ROWS_PER_SLICE} rows; nothing was applied`,
    );
    expect(slices().at(-1)?.[0]).toBe('2026-11-18 17:00:00'); // no slice after the full one is read
    expect(applied).toEqual({ missed: [], conversation: [], outbound: [] }); // not even the 16:00 call
    expect(callbacks.publish).not.toHaveBeenCalled();

    cdr.full = null;
    await reconciler.tick(new Date(NOW.getTime() + 5 * MIN));
    expect(slices()[0][0]).toBe('2026-11-16 18:05:00'); // still the whole lookback: the startup run never succeeded
    expect(applied.conversation.sort()).toEqual(['u1', 'u2']);
  });

  it('a slice with exactly MAX_ROWS_PER_SLICE rows is whole', async () => {
    const rows = Array.from({ length: MAX_ROWS_PER_SLICE }, (_, i) =>
      leg(ago(90 * MIN), {
        uniqueid: `m${i}`,
        linkedid: `m${i}`,
        channel: 'Local/101@from-queue-1;2',
        dcontext: 'from-internal',
      }),
    );
    const { reconciler } = setup(rows);
    await expect(reconciler.sync(2, NOW)).resolves.toMatchObject({ scannedRows: MAX_ROWS_PER_SLICE, calls: 0 });
  });
});

describe('CallbacksReconciler: manual sync', () => {
  it('reads exactly the given hours (plus the guard) and leaves the periodic window alone', async () => {
    const { reconciler, slices, applied } = setup([
      leg(ago(5 * H)),
      leg(ago(6.5 * H), { uniqueid: 'u65', linkedid: 'u65' }), // in the guard: read, not applied
    ]);
    await reconciler.tick(NOW);
    slices();
    applied.conversation.length = 0;

    const result = await reconciler.sync(6, new Date(NOW.getTime() + MIN));
    const read = slices();
    expect(read[0][0]).toBe('2026-11-18 12:01:00'); // 6 h + 1 h guard before 19:01
    expect(read.at(-1)?.[1]).toBe('2026-11-18 19:02:00');
    expect(applied.conversation).toEqual(['u1']); // the 6.5 h old call started before the 6 h
    expect(result).toMatchObject({ scannedRows: 2, calls: 1 });

    await reconciler.tick(new Date(NOW.getTime() + 5 * MIN));
    expect(slices()[0][0]).toBe('2026-11-18 16:01:00'); // from the periodic run's end, not the sync's
  });

  it('a manual sync that hits the cap is refused with 503 and applies nothing', async () => {
    const { reconciler, cdr, applied } = setup([leg(ago(30 * MIN))]);
    cdr.full = '2026-11-18 17:00:00';
    await expect(reconciler.sync(3, NOW)).rejects.toMatchObject({ status: 503 });
    expect(applied.conversation).toEqual([]);
  });

  it('waits for a running tick and then reads its own window; a tick meanwhile is skipped', async () => {
    const { reconciler, read, slices } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    read.mockImplementationOnce(async () => {
      await gate;
      return [];
    });

    const startup = reconciler.tick(NOW);
    const manual = reconciler.sync(1, NOW);
    await expect(reconciler.tick(NOW)).resolves.toBeNull();
    release();
    await startup;
    const result = await manual;

    expect(result.scannedRows).toBe(0);
    const read2 = slices();
    expect(read2).toHaveLength(50 + 3); // startup (50 slices), then the sync: 1 h + 1 h guard + 1 min
    expect(read2[50][0]).toBe('2026-11-18 17:00:00');
  });
});
