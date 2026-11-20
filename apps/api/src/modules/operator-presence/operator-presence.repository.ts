import { Injectable } from '@nestjs/common';
import { type DbHost, InjectDb } from '../../database/db.js';
import type { OpenInterval, PresenceSample } from './domain/presence-state.js';
import type { PresenceIntervalFact } from './domain/presence-summary.js';
import './operator-presence.tables.js';

/** The presence log (`operator_presence_log`). Single API process: the sampler is the only writer. */
@Injectable()
export class OperatorPresenceRepository {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  private get db() {
    return this.txHost.tx;
  }

  /** Startup: intervals a crash left open end at the last time they were seen. */
  async closeDangling(): Promise<number> {
    const r = await this.db
      .updateTable('operatorPresenceLog')
      .set((eb) => ({ endedAt: eb.ref('lastSeenAt') }))
      .where('endedAt', 'is', null)
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  /** Every open interval ends at `at` (AMI disconnected, shutdown). */
  async closeAll(at: Date): Promise<number> {
    const r = await this.db
      .updateTable('operatorPresenceLog')
      .set({ endedAt: at, lastSeenAt: at })
      .where('endedAt', 'is', null)
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  async close(ids: readonly string[], at: Date): Promise<void> {
    if (!ids.length) return;
    await this.db
      .updateTable('operatorPresenceLog')
      .set({ endedAt: at, lastSeenAt: at })
      .where('id', 'in', ids)
      .where('endedAt', 'is', null)
      .execute();
  }

  async open(rows: ReadonlyArray<PresenceSample & { extension: string }>, at: Date): Promise<OpenInterval[]> {
    if (!rows.length) return [];
    const inserted = await this.db
      .insertInto('operatorPresenceLog')
      .values(
        rows.map((r) => ({
          extension: r.extension,
          state: r.state,
          pauseReason: r.state === 'paused' ? r.reason : null,
          startedAt: at,
          lastSeenAt: at,
        })),
      )
      .returning(['id', 'extension', 'state', 'pauseReason'])
      .execute();
    return inserted.map((r) => ({ id: String(r.id), extension: r.extension, state: r.state, reason: r.pauseReason }));
  }

  /** Open intervals are still being watched. */
  async touch(at: Date): Promise<void> {
    await this.db.updateTable('operatorPresenceLog').set({ lastSeenAt: at }).where('endedAt', 'is', null).execute();
  }

  async deleteEndedBefore(cutoff: Date): Promise<number> {
    const r = await this.db.deleteFrom('operatorPresenceLog').where('endedAt', '<', cutoff).executeTakeFirst();
    return Number(r.numDeletedRows);
  }

  /** Intervals overlapping [from, to). */
  intervalsOverlapping(from: Date, to: Date): Promise<PresenceIntervalFact[]> {
    return this.db
      .selectFrom('operatorPresenceLog')
      .select(['extension', 'state', 'pauseReason', 'startedAt', 'endedAt'])
      .where('startedAt', '<', to)
      .where((eb) => eb.or([eb('endedAt', 'is', null), eb('endedAt', '>', from)]))
      .orderBy('startedAt')
      .execute();
  }

  /** The oldest record kept: the presence history starts here. */
  async firstStartedAt(): Promise<Date | null> {
    const r = await this.db
      .selectFrom('operatorPresenceLog')
      .select((eb) => eb.fn.min('startedAt').as('first'))
      .executeTakeFirst();
    return r?.first ? new Date(r.first as Date) : null;
  }
}
