import { DateTime } from 'luxon';
import type { AssembledCall } from '../../pbx/calls/call-assembler.js';
import { addCallsToSeed, dayStartMs, emptySeed } from './domain/cdr-seed.js';
import type { LiveStore } from './domain/live-store.js';

const HOUR_MS = 3_600_000;
/** The CDR is read in slices of this length, at most SEED_MAX_ROWS_PER_SLICE rows each (as the callbacks reconciler). */
export const SEED_SLICE_MS = HOUR_MS;
export const SEED_MAX_ROWS_PER_SLICE = 50_000;
/**
 * Rows are read from this long before midnight, as the statistics page reads a day: a call that began yesterday
 * is then seen to have begun yesterday instead of being judged by its tail.
 */
export const SEED_DAY_GUARD_MS = 2 * HOUR_MS;
/** Read a minute past now: the PBX clock may run ahead of ours. */
const CLOCK_SKEW_MS = 60_000;
/** A late call's rows are read from this long before its start (known to the second from its id). */
const LATE_READ_MARGIN_MS = 5 * 60_000;
/**
 * A CDR-side call that ended is looked up this long after its end, then retried after the next delays: Asterisk writes
 * the CDR at hangup, a batching CDR backend a few minutes later. After the last try the call is given up.
 */
export const LATE_CALL_DELAYS_MS = [10_000, 60_000, 5 * 60_000];

/** `PbxCallsService` as the seeder uses it. */
export interface CdrCallsSource {
  readonly enabled: boolean;
  callsFromSlices(
    fromMs: number,
    toMs: number,
    opts: { sliceMs: number; maxRowsPerSlice: number },
  ): Promise<{ calls: AssembledCall[]; rows: number; queries: number }>;
}

export interface SeederLogger {
  log(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

type State = 'idle' | 'seeding' | 'seeded' | 'off';

interface LateCall {
  startedAt: number;
  tries: number;
  dueAt: number;
}

/**
 * Seeds today's live counters from the PBX CDR so that an API restart does not zero the dashboard.
 *
 *  - `begin()` at the first AMI connection: live counting starts at that second (`LiveStore.startCounting`);
 *  - `seed()` after the first channel resync: today's calls that started before that second, from the CDR, except the
 *    calls still in progress (their rows are missing or incomplete). Without the PBX database, or when the read fails,
 *    the store goes back to counting every call it sees live (`LiveStore.liveOnly`), since that second;
 *  - `ended()`: those in-progress calls end; each is read from the CDR (small window around it) and added once.
 *
 * Reads run one at a time. The next Tashkent day is counted live from its start (`LiveStore` drops the seed then).
 */
export class CounterSeeder {
  private state: State = 'idle';
  private readonly late = new Map<string, LateCall>();
  private timer: NodeJS.Timeout | null = null;
  private timerDue = 0;
  private busy = false;
  private stopped = false;
  private began = false;

  constructor(
    private readonly store: LiveStore,
    private readonly source: CdrCallsSource,
    private readonly timezone: string,
    private readonly logger: SeederLogger,
    /** The store's counters changed: publish them. */
    private readonly changed: () => void,
    private readonly clock: () => number = Date.now,
  ) {}

  /** First AMI connection: start counting live now (rounded up to a whole second). False when already started. */
  begin(): boolean {
    if (this.began) return false;
    this.began = true;
    const now = this.clock();
    this.store.startCounting(Math.ceil(now / 1000) * 1000, now);
    return true;
  }

  /** Seed today's counters from the CDR, once. Never throws: a failure leaves the counters live-only. */
  async seed(): Promise<void> {
    const boundary = this.store.countFrom;
    if (boundary === null || this.state !== 'idle' || this.stopped) return;
    const since = this.wall(boundary);
    if (!this.source.enabled) {
      this.off(`PBX database not configured: today's counters are live-only (AMI) since ${since}`);
      return;
    }
    this.state = 'seeding';
    this.busy = true;
    const date = this.store.counters.date;
    const dayStart = dayStartMs(date, this.timezone);
    const started = this.clock();
    try {
      const read = await this.source.callsFromSlices(dayStart - SEED_DAY_GUARD_MS, this.clock() + CLOCK_SKEW_MS, {
        sliceMs: SEED_SLICE_MS,
        maxRowsPerSlice: SEED_MAX_ROWS_PER_SLICE,
      });
      const { seed, added } = addCallsToSeed(emptySeed(date, dayStart, boundary), read.calls, {
        skip: (id) => this.store.calls.has(id),
      });
      if (this.stopped) return;
      if (!this.store.applySeed(seed)) {
        this.off(`day changed while seeding: counters of ${date} were not seeded`);
        return;
      }
      this.state = 'seeded';
      this.logger.log(
        `today's counters seeded from the CDR up to ${since}: ${added.length} calls, ` +
          `${read.rows} rows in ${read.queries} queries, ${this.clock() - started} ms`,
      );
      this.changed();
    } catch (err) {
      this.off(`today's counters are live-only (AMI) since ${since}: CDR seed failed: ${messageOf(err)}`);
    } finally {
      this.busy = false;
    }
    this.reschedule();
  }

  /** CDR-side calls that just ended (`LiveStore.drainSeedSideEnded`). */
  ended(calls: ReadonlyArray<{ callId: string; startedAt: number }>): void {
    if (calls.length === 0 || this.state === 'off' || this.stopped) return;
    const dueAt = this.clock() + LATE_CALL_DELAYS_MS[0];
    for (const c of calls)
      if (!this.late.has(c.callId)) this.late.set(c.callId, { startedAt: c.startedAt, tries: 0, dueAt });
    if (this.state === 'seeded') this.reschedule();
  }

  /** Calls waiting to be added (tests, diagnostics). */
  get pendingLateCalls(): number {
    return this.late.size;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Add the late calls that are due. */
  async addLateCalls(): Promise<void> {
    if (this.busy || this.stopped || this.state !== 'seeded') return;
    const seed = this.store.todaySeed;
    if (!seed) {
      this.off(null); // the day changed: it is counted live from its start
      return;
    }
    const now = this.clock();
    const due = [...this.late].filter(([, c]) => c.dueAt <= now);
    if (due.length === 0) {
      this.reschedule();
      return;
    }
    const ids = new Set(due.map(([id]) => id));
    const fromMs = Math.max(
      seed.from - SEED_DAY_GUARD_MS,
      Math.min(...due.map(([, c]) => c.startedAt)) - LATE_READ_MARGIN_MS,
    );
    this.busy = true;
    try {
      const read = await this.source.callsFromSlices(fromMs, this.clock() + CLOCK_SKEW_MS, {
        sliceMs: SEED_SLICE_MS,
        maxRowsPerSlice: SEED_MAX_ROWS_PER_SLICE,
      });
      if (this.stopped) return;
      const current = this.store.todaySeed ?? seed;
      const { seed: next, added } = addCallsToSeed(current, read.calls, {
        only: ids,
        skip: (id) => this.store.calls.has(id),
      });
      if (added.length > 0 && this.store.applySeed(next)) this.changed();
      // Found = its rows are written: added now, already in the seed, or not a call of today. Otherwise retry.
      const found = new Set(read.calls.map((c) => c.id));
      for (const [id, c] of due) {
        if (found.has(id) || next.callIds.has(id)) this.late.delete(id);
        else this.retry(id, c);
      }
      this.logger.debug(
        `late CDR calls: ${added.length} of ${due.length} added (${read.rows} rows in ${read.queries} queries)`,
      );
    } catch (err) {
      this.logger.warn(`late CDR calls not added yet: ${messageOf(err)}`);
      for (const [id, c] of due) this.retry(id, c);
    } finally {
      this.busy = false;
    }
    this.reschedule();
  }

  private retry(id: string, c: LateCall): void {
    c.tries++;
    if (c.tries >= LATE_CALL_DELAYS_MS.length) {
      this.late.delete(id);
      this.logger.debug(`call ${id}: no CDR rows after ${c.tries} tries, left out of today's counters`);
    } else {
      c.dueAt = this.clock() + LATE_CALL_DELAYS_MS[c.tries];
    }
  }

  private reschedule(): void {
    if (this.stopped || this.state !== 'seeded' || this.late.size === 0) return;
    const due = Math.min(...[...this.late.values()].map((c) => c.dueAt));
    if (this.timer && this.timerDue <= due) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerDue = due;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.addLateCalls();
      },
      Math.max(0, due - this.clock()),
    );
    this.timer.unref?.();
  }

  /** No (more) seeding: the store counts every call it sees live again (`LiveStore.liveOnly`). */
  private off(warning: string | null): void {
    this.state = 'off';
    this.late.clear();
    this.store.liveOnly();
    if (warning) this.logger.warn(warning);
  }

  private wall(ms: number): string {
    return DateTime.fromMillis(ms, { zone: this.timezone }).toFormat('HH:mm:ss');
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
