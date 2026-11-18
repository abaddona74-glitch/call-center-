import { BUSINESS_TIMEZONE, type CallbackSyncResult } from '@cc/shared';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppConfig } from '../../config/app-config.js';
import { InjectPbxDb, type PbxDb } from '../../pbx/pbx-db.module.js';
import { CallbacksService } from './callbacks.service.js';
import { deriveMissedSource, handledByLegacy } from './domain/callback-rules.js';
import { type CallFact, type CdrLeg, callFactsFromCdr, factTime } from './domain/cdr-calls.js';
import type { WorkingCalendar } from '../../common/time/working-calendar.js';
import { formatBusinessDateTime } from './domain/working-calendar.js';

const MAX_ROWS = 50_000;

/** Reads raw CDR legs for a time window (read-only PBX user). Separate class so tests can replace it. */
@Injectable()
export class CdrLegsReader {
  constructor(@InjectPbxDb() private readonly pbx: PbxDb) {}

  get available(): boolean {
    return this.pbx !== null;
  }

  /** `from`/`to` are PBX wall-clock strings (Asia/Tashkent); half-open window. */
  async read(from: string, to: string): Promise<CdrLeg[]> {
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
        'linkedid',
      ])
      .where('calldate', '>=', from)
      .where('calldate', '<', to)
      .orderBy('calldate')
      .limit(MAX_ROWS)
      .execute();
    return rows.map((r) => ({ ...r, duration: Number(r.duration), billsec: Number(r.billsec) }));
  }
}

/**
 * Periodic reconciliation from the PBX CDR: replays calls of the last N hours through the same
 * callback rules as the live AMI events. Idempotent (calls are keyed by linkedid), so it is safe to
 * run any time — it only fills what the live path missed (API restart, AMI outage).
 * Calls the imported legacy history already covers are skipped (see `handledByLegacy`).
 */
@Injectable()
export class CallbacksReconciler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CallbacksReconciler.name);
  private running: Promise<CallbackSyncResult> | null = null;
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
    const hours = this.config.get('CALLBACKS_RECONCILE_LOOKBACK_HOURS');
    const tick = () =>
      void this.run(hours).catch((err: unknown) => this.logger.warn(`reconciliation failed: ${String(err)}`));
    this.scheduler.addInterval('callbacks-reconcile', setInterval(tick, seconds * 1000));
    this.startupTimer = setTimeout(tick, 15_000);
  }

  onApplicationShutdown(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
  }

  /** One run at a time; a second caller waits for the running one. */
  run(hours: number, now = new Date()): Promise<CallbackSyncResult> {
    this.running ??= this.doRun(hours, now).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRun(hours: number, now: Date): Promise<CallbackSyncResult> {
    const startedAt = new Date();
    const from = formatBusinessDateTime(new Date(now.getTime() - hours * 3_600_000), BUSINESS_TIMEZONE);
    const to = formatBusinessDateTime(new Date(now.getTime() + 60_000), BUSINESS_TIMEZONE);
    const legs = await this.reader.read(from, to);
    if (legs.length >= MAX_ROWS) this.logger.warn(`CDR window ${from}..${to} hit the ${MAX_ROWS} row limit`);

    const facts = callFactsFromCdr(legs, { timezone: BUSINESS_TIMEZONE });
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
