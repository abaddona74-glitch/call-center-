import { BUSINESS_TIMEZONE, type CallbackSyncResult } from '@cc/shared';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { sql } from 'kysely';
import { AppConfig } from '../../config/app-config.js';
import { InjectPbxDb, type PbxDb } from '../../pbx/pbx-db.module.js';
import { CallbacksService } from './callbacks.service.js';
import { deriveMissedSource, handledByLegacy } from './domain/callback-rules.js';
import { type CallFact, type CdrLeg, callFactsFromCdr, factTime } from './domain/cdr-calls.js';
import { type CdrWindow, cdrWindow, timeSlices } from './domain/cdr-window.js';
import type { WorkingCalendar } from '../../common/time/working-calendar.js';
import { formatBusinessDateTime } from './domain/working-calendar.js';

const HOUR_MS = 3_600_000;

/** The CDR is read in consecutive slices of this length, so no single query returns an unbounded result. */
export const CDR_SLICE_MS = HOUR_MS;
/**
 * Safety cap per slice (~3× the busiest hour seen in production, 18k raw rows on 2026-11-18). A slice that hits
 * it means the window cannot be read whole: the run applies nothing rather than act on a cut-off window.
 */
export const MAX_ROWS_PER_SLICE = 50_000;
/**
 * Asterisk writes a CDR row when the call ends, but dates it (`calldate`) when the call started, so rows show up
 * late by up to the call's length. Each periodic run therefore re-applies calls that started this long before the
 * previous run's end; calls are idempotent (callback_events (kind, call_id)), so re-applying is harmless.
 * A call longer than this that the live AMI path also missed is caught by the next startup or a manual sync.
 */
export const LATE_CDR_OVERLAP_MS = 2 * HOUR_MS;
/**
 * Rows of one call can be dated apart (IVR, queue attempts, a transfer after the answer). Each run reads this much
 * before the first call it applies, so a call that started earlier is seen to have started earlier and is left
 * alone instead of being judged by its tail (`startedFrom` in callFactsFromCdr).
 */
export const CALL_SPAN_GUARD_MS = HOUR_MS;
/** Read a minute past now: the PBX clock may run ahead of ours. */
const CLOCK_SKEW_MS = 60_000;

/** A slice had more rows than MAX_ROWS_PER_SLICE: nothing from the run was applied. */
export class CdrWindowTruncatedError extends ServiceUnavailableException {
  constructor(from: string, to: string, cap: number) {
    super(`CDR slice ${from}..${to} has more than ${cap} rows; nothing was applied`);
  }
}

/** Reads raw CDR legs of one time slice (read-only PBX user). Separate class so tests can replace it. */
@Injectable()
export class CdrLegsReader {
  private readonly hasLinkedid: boolean;

  constructor(
    @InjectPbxDb() private readonly pbx: PbxDb,
    config: AppConfig,
  ) {
    // Some Issabel PBXs have no cdr.linkedid column (PBX_CDR_HAS_LINKEDID=false): legs are keyed by uniqueid.
    this.hasLinkedid = config.get('PBX_CDR_HAS_LINKEDID');
  }

  get available(): boolean {
    return this.pbx !== null;
  }

  /**
   * At most `limit` legs dated in `[from, to)`, oldest first. `from`/`to` are PBX wall-clock strings
   * (Asia/Tashkent). Without linkedid the queue members' own ring attempts are left out in SQL: keyed by
   * uniqueid they never make a fact, and they are about half of all rows (see `isQueueMemberRingAttempt`).
   */
  async read(from: string, to: string, limit: number): Promise<CdrLeg[]> {
    if (!this.pbx) throw new ServiceUnavailableException('PBX unavailable');
    const rows = await this.pbx
      .selectFrom('cdr')
      .select([
        'calldate',
        'src',
        'dst',
        'dcontext',
        'channel',
        'dstchannel',
        'lastdata',
        'disposition',
        'duration',
        'billsec',
        'uniqueid',
      ])
      .select(this.hasLinkedid ? sql<string>`linkedid`.as('linkedid') : sql<string>`uniqueid`.as('linkedid'))
      .where('calldate', '>=', from)
      .where('calldate', '<', to)
      .$if(!this.hasLinkedid, (qb) =>
        qb.where((eb) =>
          eb.not(
            eb.and([eb('channel', 'like', 'Local/%'), eb('dcontext', '=', 'from-internal'), eb('dstchannel', '=', '')]),
          ),
        ),
      )
      .orderBy('calldate')
      .limit(limit)
      .execute();
    return rows.map((r) => ({ ...r, duration: Number(r.duration), billsec: Number(r.billsec) }));
  }
}

/**
 * Reconciliation from the PBX CDR: replays calls through the same callback rules as the live AMI events.
 * Idempotent (calls are keyed by linkedid / uniqueid), so it only fills what the live path missed (API restart,
 * AMI outage). Calls the imported legacy history already covers are skipped (see `handledByLegacy`).
 *
 *  - startup: the whole `CALLBACKS_RECONCILE_LOOKBACK_HOURS`;
 *  - every `CALLBACKS_RECONCILE_INTERVAL_SEC`: from the previous successful run's end minus LATE_CDR_OVERLAP_MS,
 *    never further back than the lookback. A failed or truncated run does not move that point;
 *  - manual sync (`POST /callbacks/sync`): exactly the given hours; it does not move the periodic window.
 *
 * Rows are read in slices and grouped into calls only after the whole window is read, so calls that cross a
 * slice boundary stay whole. If any slice hits MAX_ROWS_PER_SLICE nothing is applied.
 */
@Injectable()
export class CallbacksReconciler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CallbacksReconciler.name);
  /** End (`to`) of the last successful periodic run; null until the first one (startup). */
  private lastEnd: Date | null = null;
  /** Runs execute one after another; this is the tail of that queue. */
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private startupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly reader: CdrLegsReader,
    private readonly callbacks: CallbacksService,
    private readonly config: AppConfig,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.config.get('CALLBACKS_RECONCILE_INTERVAL_SEC');
    if (seconds === 0 || !this.reader.available) {
      this.logger.log('CDR reconciliation of callbacks is off');
      return;
    }
    const tick = () =>
      void this.tick().catch((err: unknown) =>
        this.logger.warn(
          err instanceof CdrWindowTruncatedError ? err.message : `reconciliation failed: ${String(err)}`,
        ),
      );
    this.scheduler.addInterval('callbacks-reconcile', setInterval(tick, seconds * 1000));
    this.startupTimer = setTimeout(tick, 15_000);
  }

  onApplicationShutdown(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
  }

  /**
   * Periodic run (the first one is the startup run). Skipped (null) while another run is running or waiting:
   * the window is not moved, so the next tick covers it.
   */
  tick(now?: Date): Promise<CallbackSyncResult | null> {
    if (this.queued > 0) return Promise.resolve(null);
    return this.exclusive(async () => {
      const window = cdrWindow({
        now: now ?? new Date(),
        lookbackMs: this.config.get('CALLBACKS_RECONCILE_LOOKBACK_HOURS') * HOUR_MS,
        lastEnd: this.lastEnd,
        overlapMs: LATE_CDR_OVERLAP_MS,
        guardMs: CALL_SPAN_GUARD_MS,
        skewMs: CLOCK_SKEW_MS,
      });
      const result = await this.reconcile(window);
      this.lastEnd = window.to;
      return result;
    });
  }

  /** Manual re-check of exactly the last `hours`; waits for a running run instead of reusing its result. */
  sync(hours: number, now?: Date): Promise<CallbackSyncResult> {
    return this.exclusive(() =>
      this.reconcile(
        cdrWindow({
          now: now ?? new Date(),
          lookbackMs: hours * HOUR_MS,
          lastEnd: null,
          overlapMs: 0,
          guardMs: CALL_SPAN_GUARD_MS,
          skewMs: CLOCK_SKEW_MS,
        }),
      ),
    );
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    this.queued++;
    const result = this.tail.then(run).finally(() => {
      this.queued--;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async reconcile(window: CdrWindow): Promise<CallbackSyncResult> {
    const startedAt = new Date();
    const legs = await this.readWindow(window);
    const facts = callFactsFromCdr(legs, { timezone: BUSINESS_TIMEZONE, startedFrom: window.applyFrom });
    this.logger.debug(
      `CDR ${formatBusinessDateTime(window.readFrom, BUSINESS_TIMEZONE)}..${formatBusinessDateTime(window.to, BUSINESS_TIMEZONE)}: ${legs.length} rows, ${facts.length} calls`,
    );
    const calendar = this.callbacks.calendar();
    const { minTalkSeconds } = await this.callbacks.settings();
    const legacyUntil = await this.callbacks.legacyImportedUntil();
    const result = { created: 0, appended: 0, resolved: 0, failedAttempts: 0, skipped: 0 };
    const changed: number[] = [];

    for (const fact of facts) {
      if (handledByLegacy(factTime(fact), legacyUntil)) {
        result.skipped++;
        continue;
      }
      const { outcome, callbackId } = await this.callbacks.applyQuietly(() =>
        this.apply(fact, calendar, minTalkSeconds),
      );
      if (callbackId !== null) changed.push(callbackId);
      if (outcome === 'created') result.created++;
      else if (outcome === 'appended') result.appended++;
      else if (outcome === 'resolved') result.resolved++;
      else if (outcome === 'attempt') result.failedAttempts++;
      else result.skipped++;
    }

    await this.callbacks.publish(changed);
    if (changed.length > 0) {
      this.logger.log(
        `reconciled ${facts.length} calls: +${result.created} new, ${result.appended} appended, ${result.resolved} resolved, ${result.failedAttempts} attempts`,
      );
    }
    return {
      scannedRows: legs.length,
      calls: facts.length,
      ...result,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }

  /** The whole window, slice by slice; throws CdrWindowTruncatedError (before anything is applied) on a full slice. */
  private async readWindow(window: CdrWindow): Promise<CdrLeg[]> {
    const chunks: CdrLeg[][] = [];
    for (const slice of timeSlices(window.readFrom, window.to, CDR_SLICE_MS)) {
      const from = formatBusinessDateTime(slice.from, BUSINESS_TIMEZONE);
      const to = formatBusinessDateTime(slice.to, BUSINESS_TIMEZONE);
      const rows = await this.reader.read(from, to, MAX_ROWS_PER_SLICE + 1);
      if (rows.length > MAX_ROWS_PER_SLICE) throw new CdrWindowTruncatedError(from, to, MAX_ROWS_PER_SLICE);
      chunks.push(rows);
    }
    return chunks.flat();
  }

  private apply(
    fact: CallFact,
    calendar: WorkingCalendar,
    minTalkSeconds: number,
  ): ReturnType<CallbacksService['applyMissed']> {
    switch (fact.kind) {
      case 'missed': {
        const source = deriveSource(fact, calendar);
        return this.callbacks.applyMissed({ callId: fact.callId, phone: fact.phone, at: fact.startedAt, source });
      }
      case 'conversation':
        return this.callbacks.applyConversation(
          {
            callId: fact.callId,
            phone: fact.phone,
            direction: fact.direction,
            extension: fact.extension,
            endedAt: fact.endedAt,
            talkSeconds: fact.talkSeconds,
          },
          minTalkSeconds,
        );
      case 'outbound_failed':
        return this.callbacks.applyOutboundFailure({
          callId: fact.callId,
          phone: fact.phone,
          extension: fact.extension,
          at: fact.at,
          cause: fact.cause,
        });
    }
  }
}

function deriveSource(fact: Extract<CallFact, { kind: 'missed' }>, calendar: WorkingCalendar) {
  return deriveMissedSource({
    startedAt: fact.startedAt,
    operatorRang: fact.operatorRang,
    ivrAfterHours: fact.ivrAfterHours,
    calendar,
  });
}
