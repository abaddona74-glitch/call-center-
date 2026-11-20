import type { AmiStatus } from '@cc/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import type { AmiService } from '../ami/ami.service.js';
import { LiveStore } from '../live/domain/live-store.js';
import type { LiveService } from '../live/live.service.js';
import type { OpenInterval, PresenceSample } from './domain/presence-state.js';
import type { OperatorPresenceRepository } from './operator-presence.repository.js';
import { OperatorPresenceService } from './operator-presence.service.js';

interface Row {
  id: string;
  extension: string;
  state: PresenceSample['state'];
  pauseReason: string | null;
  startedAt: Date;
  endedAt: Date | null;
  lastSeenAt: Date;
}

/** In-memory presence log with the repository's semantics. */
class MemoryRepo {
  rows: Row[] = [];
  private seq = 0;
  async closeDangling() {
    let n = 0;
    for (const r of this.rows.filter((x) => !x.endedAt)) {
      r.endedAt = r.lastSeenAt;
      n++;
    }
    return n;
  }
  async closeAll(at: Date) {
    let n = 0;
    for (const r of this.rows.filter((x) => !x.endedAt)) {
      r.endedAt = at;
      r.lastSeenAt = at;
      n++;
    }
    return n;
  }
  async close(ids: readonly string[], at: Date) {
    for (const r of this.rows.filter((x) => ids.includes(x.id) && !x.endedAt)) {
      r.endedAt = at;
      r.lastSeenAt = at;
    }
  }
  async open(rows: ReadonlyArray<PresenceSample & { extension: string }>, at: Date): Promise<OpenInterval[]> {
    return rows.map((r) => {
      if (this.rows.some((x) => x.extension === r.extension && !x.endedAt)) throw new Error('duplicate open interval');
      const row: Row = {
        id: String(++this.seq),
        extension: r.extension,
        state: r.state,
        pauseReason: r.state === 'paused' ? r.reason : null,
        startedAt: at,
        endedAt: null,
        lastSeenAt: at,
      };
      this.rows.push(row);
      return { id: row.id, extension: row.extension, state: row.state, reason: row.pauseReason };
    });
  }
  async touch(at: Date) {
    for (const r of this.rows.filter((x) => !x.endedAt)) r.lastSeenAt = at;
  }
  async deleteEndedBefore(cutoff: Date) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !r.endedAt || r.endedAt >= cutoff);
    return before - this.rows.length;
  }
  async intervalsOverlapping() {
    return [];
  }
  async firstStartedAt() {
    return null;
  }
}

class FakeAmi {
  enabled = true;
  connected = false;
  private events = new Set<() => void>();
  private statuses = new Set<(s: AmiStatus) => void>();
  onEvent(l: () => void) {
    this.events.add(l);
    return () => this.events.delete(l);
  }
  onStatus(l: (s: AmiStatus) => void) {
    this.statuses.add(l);
    return () => this.statuses.delete(l);
  }
  emitEvent() {
    for (const l of this.events) l();
  }
  setConnected(connected: boolean) {
    this.connected = connected;
    for (const l of this.statuses)
      l({ enabled: true, state: connected ? 'connected' : 'disconnected', since: null, lastError: null });
  }
}

const T0 = Date.parse('2026-11-19T04:00:00Z'); // 09:00 Tashkent
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

describe('OperatorPresenceService', () => {
  let store: LiveStore;
  let repo: MemoryRepo;
  let ami: FakeAmi;
  let service: OperatorPresenceService;

  const view = () =>
    repo.rows.map((r) => [
      r.extension,
      r.state,
      r.pauseReason,
      r.startedAt.toISOString(),
      r.endedAt?.toISOString() ?? null,
    ]);
  /** Let the timers fire and the write chain finish. */
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    store = new LiveStore({ operatorExtension: /^1\d\d$/, timezone: 'Asia/Tashkent' }, T0);
    store.setDirectory(
      [
        { extension: '101', name: 'Aziza' },
        { extension: '102', name: 'Bobur' },
      ],
      T0,
    );
    repo = new MemoryRepo();
    ami = new FakeAmi();
    service = new OperatorPresenceService(
      repo as unknown as OperatorPresenceRepository,
      { store } as unknown as LiveService,
      ami as unknown as AmiService,
      { get: () => 400 } as unknown as AppConfig,
    );
    await service.onApplicationBootstrap();
  });

  afterEach(async () => {
    await service.beforeApplicationShutdown();
    vi.useRealTimers();
  });

  it('writes nothing until AMI is connected and the state has settled', async () => {
    await advance(30_000);
    expect(repo.rows).toEqual([]);
    vi.setSystemTime(T0 + 30_000);
    ami.setConnected(true);
    await advance(1_000);
    expect(repo.rows).toEqual([]);
  });

  it('records registration, pauses with reasons and closes everything on disconnect and shutdown', async () => {
    ami.setConnected(true);
    store.applyPeers(
      [
        { event: 'PeerEntry', objectname: '101', status: 'OK (5 ms)' },
        { event: 'PeerEntry', objectname: '102', status: 'UNREACHABLE' },
      ],
      Date.now(),
    );
    await advance(5_100); // settle → first sample at +5.1 s
    expect(view()).toEqual([
      ['101', 'online', null, at(5.1), null],
      ['102', 'offline', null, at(5.1), null],
    ]);

    // 101 pauses for lunch (sampled one second after the event burst).
    await advance(4_900);
    store.apply(
      {
        event: 'QueueMemberPause',
        queue: '2020159',
        interface: 'Local/101@from-queue/n',
        paused: '1',
        pausedreason: 'Tushlik',
      },
      Date.now(),
    );
    ami.emitEvent();
    await advance(1_000);
    expect(view().slice(2)).toEqual([['101', 'paused', 'Tushlik', at(11), null]]);
    expect(repo.rows[0].endedAt?.toISOString()).toBe(at(11));

    // AMI goes away: the state is unknown, every interval ends.
    await advance(9_000);
    ami.setConnected(false);
    await advance(10);
    expect(repo.rows.every((r) => r.endedAt)).toBe(true);
    expect(repo.rows.find((r) => r.state === 'paused')?.endedAt?.toISOString()).toBe(at(20));

    // Back: new intervals after the settle time; shutdown closes them.
    ami.setConnected(true);
    await advance(5_200);
    expect(repo.rows.filter((r) => !r.endedAt).map((r) => [r.extension, r.state])).toEqual([
      ['101', 'paused'],
      ['102', 'offline'],
    ]);
    await service.beforeApplicationShutdown();
    expect(repo.rows.every((r) => r.endedAt)).toBe(true);
  });

  it('heartbeat keeps last_seen_at fresh; the next start closes dangling rows there', async () => {
    ami.setConnected(true);
    store.applyPeers([{ event: 'PeerEntry', objectname: '101', status: 'OK (5 ms)' }], Date.now());
    await advance(5_100);
    await advance(60_000);
    const row = repo.rows.find((r) => r.extension === '101')!;
    expect(row.lastSeenAt.getTime()).toBeGreaterThanOrEqual(T0 + 60_000);
    // A crash: no shutdown hook. The next run closes the interval at its last_seen_at.
    const seen = row.lastSeenAt.getTime();
    const next = new OperatorPresenceService(
      repo as unknown as OperatorPresenceRepository,
      { store } as unknown as LiveService,
      { ...ami, enabled: false } as unknown as AmiService,
      { get: () => 400 } as unknown as AppConfig,
    );
    await next.onApplicationBootstrap();
    expect(row.endedAt?.getTime()).toBe(seen);
  });

  it('retention deletes intervals that ended before the cut-off', async () => {
    repo.rows.push({
      id: 'old',
      extension: '101',
      state: 'online',
      pauseReason: null,
      startedAt: new Date('2025-01-01T00:00:00Z'),
      endedAt: new Date('2025-01-01T01:00:00Z'),
      lastSeenAt: new Date('2025-01-01T01:00:00Z'),
    });
    expect(await service.purge(new Date('2026-11-19T00:00:00Z'))).toBe(1);
    expect(repo.rows).toEqual([]);
  });
});
