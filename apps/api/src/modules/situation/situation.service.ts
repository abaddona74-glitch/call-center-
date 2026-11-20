import {
  BUSINESS_TIMEZONE,
  type SituationSnapshot,
  type SituationTelephony,
  type SituationTickets,
  type SituationWorkday,
} from '@cc/shared';
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { CallEvents, TicketEvents } from '../../common/events/domain-events.js';
import { AppConfig } from '../../config/app-config.js';
import { AmiService } from '../ami/ami.service.js';
import { ExcludedOperatorsService } from '../excluded-operators/excluded-operators.service.js';
import { LiveService } from '../live/live.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service.js';
import { type SituationTelephonyState, buildSituationTelephony, telephonyKey } from './domain/telephony-situation.js';
import { buildSituationTickets } from './domain/ticket-situation.js';
import { SituationRepository } from './situation.repository.js';

/** Telephony: look for changes this often; push only when something changed (at most one push a second). */
export const TELEPHONY_PUSH_MS = 1_000;
/** Tickets: a change is pushed after this pause (a burst of changes → one push). */
export const TICKETS_DEBOUNCE_MS = 1_000;
/** Tickets: pushed this often anyway — deadlines pass without an event; doubles as the board's heartbeat. */
export const TICKETS_REFRESH_MS = 30_000;

/**
 * The live situation board «Hozirgi holat» (observers and the superuser, permission `situation.view`). Read-only:
 *  - telephony: the live module's projections, unmasked (domain/telephony-situation.ts);
 *  - tickets: the tickets tables with the tickets module's SLA rules (domain/ticket-situation.ts).
 * Pushes `situation.*` WS events only to `situation.view` users, and does no work while none of them is connected.
 */
@Injectable()
export class SituationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SituationService.name);
  private timers: NodeJS.Timeout[] = [];
  private lastTelephony: string | null = null;
  private ticketsTimer: NodeJS.Timeout | null = null;
  private ticketsRunning = false;
  private ticketsAgain = false;

  constructor(
    private readonly live: LiveService,
    private readonly ami: AmiService,
    private readonly excluded: ExcludedOperatorsService,
    private readonly calendar: WorkingCalendarService,
    private readonly repo: SituationRepository,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.timers.push(
      setInterval(() => this.pushTelephony(), TELEPHONY_PUSH_MS),
      setInterval(() => this.scheduleTickets(0), TICKETS_REFRESH_MS),
    );
    for (const t of this.timers) t.unref();
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearInterval(t);
    if (this.ticketsTimer) clearTimeout(this.ticketsTimer);
  }

  // --- reads ----------------------------------------------------------------------------------

  async snapshot(now = new Date()): Promise<SituationSnapshot> {
    return { telephony: this.telephony(now.getTime()), tickets: await this.tickets(now) };
  }

  telephony(now = Date.now()): SituationTelephony {
    return { ...this.telephonyState(now), serverTime: new Date(now).toISOString() };
  }

  async tickets(now = new Date()): Promise<SituationTickets> {
    const day = DateTime.fromJSDate(now, { zone: BUSINESS_TIMEZONE }).startOf('day');
    const dayStart = day.toJSDate();
    const dayEnd = day.plus({ days: 1 }).toJSDate();
    const [open, today, callbacks, resolvedTodayBy, regions, executives] = await Promise.all([
      this.repo.notClosed(),
      this.repo.countsSince(dayStart),
      this.repo.callbacksBetween(dayStart, dayEnd),
      this.repo.resolvedSinceBy(dayStart),
      this.repo.regions(),
      this.repo.executives(),
    ]);
    const known = new Set(executives.map((e) => e.userId));
    const holders = [
      ...new Set(open.map((t) => t.assigneeUserId).filter((id): id is number => id !== null && !known.has(id))),
    ];
    return buildSituationTickets({
      open,
      today,
      callbacks,
      resolvedTodayBy,
      regions,
      executives,
      usernames: await this.repo.usernames(holders),
      now,
      dayEnd,
      slaWorkingDays: this.config.get('TICKETS_SLA_WORKING_DAYS'),
      callbackSlaWorkingDays: this.config.get('TICKETS_CALLBACK_SLA_WORKING_DAYS'),
    });
  }

  // --- pushes ---------------------------------------------------------------------------------

  /** A ticket changed somewhere (tickets module): push the tickets part once the burst settles. */
  @OnEvent(TicketEvents.Changed)
  onTicketChanged(): void {
    this.scheduleTickets(TICKETS_DEBOUNCE_MS);
  }

  /**
   * A call event that may open or resolve a callback (callbacks module): refresh today's callbacks with the tickets
   * part. The debounce gives the callbacks listener time to write first; the 30 s refresh catches anything later.
   */
  @OnEvent(CallEvents.Abandoned)
  @OnEvent(CallEvents.OperatorMissed)
  @OnEvent(CallEvents.Ended)
  onCallChanged(): void {
    if (this.hasAudience()) this.scheduleTickets(TICKETS_DEBOUNCE_MS);
  }

  private hasAudience(): boolean {
    return this.realtime.audience('situation.view') > 0;
  }

  /** Every second: push the telephony part when it differs from the last push. */
  private pushTelephony(): void {
    if (!this.hasAudience()) {
      // Nobody watching: forget the last push, so the next viewer's first tick sends the current state.
      this.lastTelephony = null;
      return;
    }
    const now = Date.now();
    const state = this.telephonyState(now);
    const key = telephonyKey(state);
    if (key === this.lastTelephony) return;
    this.lastTelephony = key;
    this.realtime.broadcast(
      'situation.telephony',
      { ...state, serverTime: new Date(now).toISOString() },
      { permission: 'situation.view' },
    );
  }

  private scheduleTickets(delayMs: number): void {
    if (this.ticketsTimer) return;
    this.ticketsTimer = setTimeout(() => {
      this.ticketsTimer = null;
      void this.pushTickets();
    }, delayMs);
    this.ticketsTimer.unref();
  }

  private async pushTickets(): Promise<void> {
    if (!this.hasAudience()) return;
    if (this.ticketsRunning) {
      this.ticketsAgain = true;
      return;
    }
    this.ticketsRunning = true;
    try {
      const data = await this.tickets();
      this.realtime.broadcast('situation.tickets', data, { permission: 'situation.view' });
    } catch (err) {
      this.logger.warn(`situation tickets failed: ${(err as Error).message}`);
    } finally {
      this.ticketsRunning = false;
      if (this.ticketsAgain) {
        this.ticketsAgain = false;
        this.scheduleTickets(0);
      }
    }
  }

  // --- internals ------------------------------------------------------------------------------

  private telephonyState(now: number): SituationTelephonyState {
    return buildSituationTelephony({
      store: this.live.store,
      now,
      hidden: this.excluded.extensions(),
      ami: this.ami.status(),
      workday: this.workday(now),
    });
  }

  private workday(now: number): SituationWorkday {
    const cal = this.calendar.get();
    const info = cal.info();
    const date = DateTime.fromMillis(now, { zone: BUSINESS_TIMEZONE }).toISODate() as string;
    return { date, working: cal.isWorkingDay(date), start: info.start, end: info.end };
  }
}
