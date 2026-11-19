import type { Generated, Selectable } from 'kysely';
import type { PresenceState } from './domain/presence-state.js';

/** One state interval of an operator phone (migration 202611191810_operator_presence_log). */
export interface OperatorPresenceLogTable {
  id: Generated<string>;
  extension: string;
  state: PresenceState;
  /** Only for `paused`: the reason the operator gave (null = none). */
  pauseReason: string | null;
  startedAt: Date;
  /** null = still open. */
  endedAt: Date | null;
  /** Refreshed while open; a crash leaves the interval to be closed at this time on the next start. */
  lastSeenAt: Date;
}

export type OperatorPresenceLogRow = Selectable<OperatorPresenceLogTable>;

declare module '../../database/db.js' {
  interface DB {
    operatorPresenceLog: OperatorPresenceLogTable;
  }
}
