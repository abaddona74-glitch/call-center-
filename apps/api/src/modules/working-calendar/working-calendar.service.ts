import {
  DEFAULT_WORKING_CALENDAR,
  type SessionUser,
  type WorkingCalendarInfo,
  type WorkingCalendarInput,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'kysely';
import { WorkingCalendar } from '../../common/time/working-calendar.js';
import { type DbHost, InjectDb } from '../../database/db.js';
import { AuditService } from '../audit/audit.service.js';
import './working-calendar.tables.js';

/** Emitted after the calendar changed (cached "working hours" flags must be recomputed). */
export const WORKING_CALENDAR_CHANGED = 'working-calendar.changed';

/**
 * The one working calendar (owner decision 2026-11-18), kept in memory for the synchronous checks of
 * statistics, callbacks and ticket deadlines; loaded at startup (after migrations) and on every change.
 */
@Injectable()
export class WorkingCalendarService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkingCalendarService.name);
  private calendar = WorkingCalendar.fromInput(DEFAULT_WORKING_CALENDAR);

  constructor(
    @InjectDb() private readonly txHost: DbHost,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.reload();
  }

  get(): WorkingCalendar {
    return this.calendar;
  }

  info(): WorkingCalendarInfo {
    return this.calendar.info();
  }

  async update(input: WorkingCalendarInput, user: SessionUser): Promise<WorkingCalendarInfo> {
    await this.save(input, user);
    await this.reload();
    this.logger.log(`working calendar changed by ${user.username}`);
    this.events.emit(WORKING_CALENDAR_CHANGED, this.calendar);
    return this.info();
  }

  @Transactional()
  private async save(input: WorkingCalendarInput, user: SessionUser): Promise<void> {
    const before = this.info();
    await this.txHost.tx
      .updateTable('workingCalendar')
      .set({
        days: sql<number[]>`${sql.val([...input.days].sort((a, b) => a - b))}::smallint[]`,
        startTime: input.start,
        endTime: input.end,
        holidays: sql<string[]>`${sql.val([...input.holidays].sort())}::text[]`,
        updatedAt: sql<Date>`now()`,
        updatedByUserId: user.id,
      })
      .where('id', '=', 1)
      .execute();
    const { timezone: _tz, ...was } = before;
    await this.audit.record('workingCalendar.update', {
      target: 'working_calendar',
      details: { before: was, after: input },
    });
  }

  private async reload(): Promise<void> {
    const row = await this.txHost.tx
      .selectFrom('workingCalendar')
      .select(['days', 'startTime', 'endTime', 'holidays'])
      .where('id', '=', 1)
      .executeTakeFirst();
    if (!row) throw new Error('working_calendar is empty: run the database migrations');
    this.calendar = WorkingCalendar.fromInput({
      days: row.days.map(Number),
      start: row.startTime,
      end: row.endTime,
      holidays: [...row.holidays],
    });
  }
}
