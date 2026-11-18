import {
  BUSINESS_TIMEZONE,
  type LiveCall,
  type LiveOperator,
  type LiveQueue,
  type LiveSnapshot,
  type SessionUser,
} from '@cc/shared';
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { SettingsEvents } from '../../common/events/domain-events.js';
import { AppConfig } from '../../config/app-config.js';
import { ExcludedOperatorsService } from '../excluded-operators/excluded-operators.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { AmiService } from '../ami/ami.service.js';
import { LiveStore, type LiveSection } from './domain/live-store.js';
import {
  type Viewer,
  callsFor,
  isPrivileged,
  operatorsFor,
  projectCalls,
  projectCounters,
  projectOperators,
  projectQueues,
  queuesFor,
} from './domain/projection.js';
import { LiveRepository } from './live.repository.js';

const PUBLISH_DEBOUNCE_MS = 200;
const DIRECTORY_REFRESH_MS = 5 * 60_000;
const TICK_MS = 15_000;

/**
 * Runtime around the pure LiveStore: feeds it AMI events and periodic resyncs, publishes
 * domain events (`CallEvents.*`) and pushes role-filtered snapshots over WebSocket.
 */
@Injectable()
export class LiveService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LiveService.name);
  readonly store: LiveStore;
  private readonly dirty = new Set<LiveSection>();
  private publishTimer: NodeJS.Timeout | null = null;
  private timers: NodeJS.Timeout[] = [];
  private unsubscribe: Array<() => void> = [];
  private pollTick = 0;
  private resyncing = false;

  constructor(
    private readonly ami: AmiService,
    private readonly realtime: RealtimeService,
    private readonly events: EventEmitter2,
    private readonly repo: LiveRepository,
    private readonly config: AppConfig,
    private readonly excluded: ExcludedOperatorsService,
  ) {
    this.store = new LiveStore(
      { operatorExtension: new RegExp(config.get('LIVE_OPERATOR_EXTENSION_PATTERN')), timezone: BUSINESS_TIMEZONE },
      Date.now(),
    );
  }

  onApplicationBootstrap(): void {
    this.unsubscribe.push(
      this.ami.onEvent((evt) => {
        this.store.apply(evt, Date.now());
        this.flush();
      }),
      this.ami.onStatus((status) => {
        this.realtime.broadcast('telephony.ami', status);
        if (status.state === 'connected') void this.resync(true);
      }),
    );
    void this.loadDirectory();
    this.timers.push(
      setInterval(() => void this.loadDirectory(), DIRECTORY_REFRESH_MS),
      setInterval(() => {
        this.store.tick(Date.now());
        this.flush();
      }, TICK_MS),
      setInterval(() => void this.resync(false), this.config.get('AMI_POLL_INTERVAL_SEC') * 1000),
    );
    for (const t of this.timers) t.unref();
  }

  onApplicationShutdown(): void {
    for (const u of this.unsubscribe) u();
    for (const t of this.timers) clearInterval(t);
    if (this.publishTimer) clearTimeout(this.publishTimer);
  }

  // --- reads ----------------------------------------------------------------------------------

  snapshot(user: SessionUser): LiveSnapshot {
    const now = Date.now();
    const viewer = toViewer(user);
    return {
      operators: operatorsFor(viewer, projectOperators(this.store, now, this.excluded.extensions())),
      calls: callsFor(viewer, projectCalls(this.store, now)),
      queues: queuesFor(viewer, projectQueues(this.store)),
      counters: isPrivileged(viewer) ? projectCounters(this.store) : null,
      ami: this.ami.status(),
      serverTime: new Date(now).toISOString(),
    };
  }

  /** The citizen leg (or, if none, the operator leg) of an active call — for transfer/hangup. */
  callControl(callId: string): { call: LiveCall; partyChannel: string | null; operatorChannel: string | null } | null {
    const rec = this.store.calls.get(callId);
    if (!rec) return null;
    const call = projectCalls(this.store, Date.now()).find((c) => c.id === callId);
    if (!call) return null;
    const party = rec.partyUniqueid ? this.store.channels.get(rec.partyUniqueid) : undefined;
    const opExt = call.extension;
    const opCh = [...rec.channels]
      .map((u) => this.store.channels.get(u))
      .find((c) => c?.kind === 'operator' && c.ext === opExt);
    return { call, partyChannel: party?.name ?? null, operatorChannel: opCh?.name ?? null };
  }

  operator(ext: string): LiveOperator | undefined {
    return projectOperators(this.store, Date.now()).find((o) => o.extension === ext);
  }

  /** The excluded operators list changed: push the board again without (or with) them. */
  @OnEvent(SettingsEvents.ExcludedOperatorsChanged)
  onExcludedOperatorsChanged(): void {
    this.dirty.add('operators');
    if (!this.publishTimer) this.publishTimer = setTimeout(() => this.publish(), PUBLISH_DEBOUNCE_MS);
  }

  // --- internals ------------------------------------------------------------------------------

  /** Emit domain events and schedule a coalesced WS publish. */
  private flush(): void {
    for (const e of this.store.drainEvents()) {
      try {
        this.events.emit(e.name, e.payload);
      } catch (err) {
        this.logger.error(`${e.name} subscriber failed: ${(err as Error).stack ?? String(err)}`);
      }
    }
    for (const s of this.store.drainChanged()) this.dirty.add(s);
    if (this.dirty.size && !this.publishTimer) {
      this.publishTimer = setTimeout(() => this.publish(), PUBLISH_DEBOUNCE_MS);
    }
  }

  private publish(): void {
    this.publishTimer = null;
    const now = Date.now();
    const sections = new Set(this.dirty);
    this.dirty.clear();
    if (sections.has('operators')) {
      const list = projectOperators(this.store, now, this.excluded.extensions());
      this.realtime.broadcastEach(
        'telephony.operators',
        memo((v) => operatorsFor(v, list)),
      );
    }
    if (sections.has('calls')) {
      const list = projectCalls(this.store, now);
      this.realtime.broadcastEach(
        'telephony.calls',
        memo((v) => callsFor(v, list)),
      );
    }
    if (sections.has('queues')) {
      const list: LiveQueue[] = projectQueues(this.store);
      this.realtime.broadcastEach(
        'telephony.queues',
        memo((v) => queuesFor(v, list)),
      );
    }
    if (sections.has('counters')) {
      const counters = projectCounters(this.store);
      this.realtime.broadcastEach('telephony.counters', (user) =>
        isPrivileged(toViewer(user)) ? counters : undefined,
      );
    }
  }

  /** On (re)connect and periodically: peers + queues; CoreShowChannels on connect and every 4th tick. */
  private async resync(full: boolean): Promise<void> {
    if (!this.ami.connected || this.resyncing) return;
    this.resyncing = true;
    // Each poll is independent: a user without the privilege for one action (e.g. PJSIPShowEndpoints
    // needs `system`, see modules/ami/README.md) must not block the others.
    const step = async <T>(name: string, run: () => Promise<T>, apply: (v: T) => void) => {
      try {
        apply(await run());
      } catch (err) {
        this.logger.warn(`AMI resync: ${name} failed: ${(err as Error).message}`);
      }
    };
    try {
      await Promise.all([
        step(
          'peers',
          () => this.ami.peers(),
          (v) => this.store.applyPeers(v, Date.now()),
        ),
        step(
          'QueueStatus',
          () => this.ami.queueStatus(),
          (v) => this.store.applyQueueStatus(v, Date.now()),
        ),
      ]);
      if (full || this.pollTick++ % 4 === 0) {
        await step(
          'CoreShowChannels',
          () => this.ami.coreShowChannels(),
          (v) => this.store.resyncChannels(v, Date.now()),
        );
      }
      this.flush();
    } finally {
      this.resyncing = false;
    }
  }

  private async loadDirectory(): Promise<void> {
    try {
      const entries = await this.repo.operatorDirectory();
      if (!entries) return;
      this.store.setDirectory(entries, Date.now());
      this.flush();
    } catch (err) {
      this.logger.warn(`operator directory unavailable: ${(err as Error).message}`);
    }
  }
}

export function toViewer(user: Pick<SessionUser, 'role' | 'extension' | 'permissions'>): Viewer {
  return { role: user.role, extension: user.extension, permissions: user.permissions };
}

/** Same projection for every privileged viewer / per operator extension (one JSON serialization per group). */
function memo<T>(fn: (v: Viewer) => T): (user: SessionUser) => T {
  const cache = new Map<string, T>();
  return (user) => {
    const viewer = toViewer(user);
    const key = isPrivileged(viewer) ? 'all' : `op:${viewer.extension ?? ''}`;
    let v = cache.get(key);
    if (v === undefined) {
      v = fn(viewer);
      cache.set(key, v);
    }
    return v;
  };
}
