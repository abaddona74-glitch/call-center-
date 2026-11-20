import { BUSINESS_TIMEZONE } from '@cc/shared';
import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppConfig } from '../../config/app-config.js';
import { AmiService } from '../ami/ami.service.js';
import { projectOperators } from '../live/domain/projection.js';
import { LiveService } from '../live/live.service.js';
import { diffPresence, type OpenInterval, type PresenceSample, sampleOf } from './domain/presence-state.js';
import type { PresenceIntervalFact } from './domain/presence-summary.js';
import { OperatorPresenceRepository } from './operator-presence.repository.js';

/** A burst of AMI events is sampled once, after it settles. */
const EVENT_DEBOUNCE_MS = 1_000;
/** Registration polls and pause changes without an event are caught by this timer. */
const SAMPLE_INTERVAL_MS = 10_000;
/** Open intervals get `last_seen_at` this often (a crash loses at most this much). */
const HEARTBEAT_MS = 60_000;
/** After (re)connecting, the live state needs a resync (peers, queue members) before it means anything. */
const SETTLE_MS = 5_000;

/**
 * The presence log (owner, 19.11.2026; docs/rewrite/METRICS.md §11.1): online / pause intervals of operator phones for
 * the staff KPI page. Reads the live board's state (LiveService + the pure `projectOperators`, the same projection the
 * board shows) — it does not change the live module — and writes a row whenever an operator's state or pause reason
 * changes. While AMI is disconnected or the API is down nothing is known, so no interval covers that time.
 */
@Injectable()
export class OperatorPresenceService
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger(OperatorPresenceService.name);
  private open = new Map<string, OpenInterval>();
  private timers: NodeJS.Timeout[] = [];
  private debounce: NodeJS.Timeout | null = null;
  private unsubscribe: Array<() => void> = [];
  private connectedAt: number | null = null;
  /** Writes run one at a time, in order. */
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly repo: OperatorPresenceRepository,
    private readonly live: LiveService,
    private readonly ami: AmiService,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const closed = await this.repo.closeDangling();
      if (closed) this.logger.log(`closed ${closed} presence interval(s) left open by the previous run`);
    } catch (err) {
      this.logger.warn(`presence log unavailable: ${(err as Error).message}`);
    }
    if (!this.ami.enabled) return;
    if (this.ami.connected) this.connectedAt = Date.now();
    this.unsubscribe.push(
      this.ami.onEvent(() => this.schedule()),
      this.ami.onStatus((status) => {
        if (status.state === 'connected') {
          this.connectedAt = Date.now();
          this.schedule(SETTLE_MS + 100);
        } else if (this.connectedAt !== null) {
          // Disconnected: the state is unknown from now on.
          this.connectedAt = null;
          this.enqueue(() => this.closeEverything(new Date()));
        }
      }),
    );
    this.timers.push(
      setInterval(() => this.enqueue(() => this.sample()), SAMPLE_INTERVAL_MS),
      setInterval(() => this.enqueue(() => this.heartbeat()), HEARTBEAT_MS),
    );
    for (const t of this.timers) t.unref();
  }

  /** Before the database pool closes (DatabaseModule closes it in onApplicationShutdown). */
  async beforeApplicationShutdown(): Promise<void> {
    this.stop();
    this.enqueue(() => this.closeEverything(new Date()));
    await this.chain;
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  /** Nightly retention (PRESENCE_LOG_RETENTION_DAYS). */
  @Cron('30 3 * * *', { timeZone: BUSINESS_TIMEZONE })
  async purge(now = new Date()): Promise<number> {
    const days = this.config.get('PRESENCE_LOG_RETENTION_DAYS');
    const deleted = await this.repo.deleteEndedBefore(new Date(now.getTime() - days * 86_400_000));
    if (deleted) this.logger.log(`presence log: deleted ${deleted} interval(s) older than ${days} days`);
    return deleted;
  }

  /** Intervals overlapping [from, to) and the start of the history (for the KPI page). */
  async history(from: Date, to: Date): Promise<{ intervals: PresenceIntervalFact[]; since: Date | null }> {
    const [intervals, since] = await Promise.all([
      this.repo.intervalsOverlapping(from, to),
      this.repo.firstStartedAt(),
    ]);
    return { intervals, since };
  }

  // --- internals --------------------------------------------------------------------------------

  private stop(): void {
    this.stopped = true;
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
  }

  private schedule(delay = EVENT_DEBOUNCE_MS): void {
    if (this.debounce || this.stopped) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.enqueue(() => this.sample());
    }, delay);
    this.debounce.unref();
  }

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch((err: unknown) => {
      this.logger.warn(`presence log write failed: ${(err as Error).message}`);
      // The DB may be out of step with the memory map now: start over from a clean state.
      this.open.clear();
      return this.repo.closeAll(new Date()).then(
        () => undefined,
        () => undefined,
      );
    });
  }

  /** Current live state → close changed intervals, open new ones (one boundary time for both). */
  private async sample(): Promise<void> {
    if (this.stopped || this.connectedAt === null || !this.ami.connected) return;
    const now = Date.now();
    if (now - this.connectedAt < SETTLE_MS) return;
    const current = new Map<string, PresenceSample>(
      projectOperators(this.live.store, now).map((op) => [op.extension, sampleOf(op)]),
    );
    const diff = diffPresence(this.open, current);
    if (!diff.close.length && !diff.open.length) return;
    const at = new Date(now);
    await this.repo.close(
      diff.close.map((c) => c.id),
      at,
    );
    for (const c of diff.close) this.open.delete(c.extension);
    for (const row of await this.repo.open(diff.open, at)) this.open.set(row.extension, row);
  }

  private async heartbeat(): Promise<void> {
    if (this.open.size) await this.repo.touch(new Date());
  }

  private async closeEverything(at: Date): Promise<void> {
    this.open.clear();
    await this.repo.closeAll(at);
  }
}
