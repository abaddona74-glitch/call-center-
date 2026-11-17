import type {
  CallbackCloseMethod,
  CallbackEventKind,
  CallbackResolutionType,
  CallbackSource,
  CallbackStatus,
  OutboundFailureCause,
} from '@cc/shared';
import type { Generated, Selectable } from 'kysely';

export interface CallbackSettingsTable {
  id: Generated<number>;
  workDays: number[];
  workStart: string;
  workEnd: string;
  holidays: string[];
  minTalkSeconds: number;
  updatedAt: Generated<Date>;
  updatedByUserId: number | null;
}

export interface CallbacksTable {
  id: Generated<number>;
  phone: string;
  status: Generated<CallbackStatus>;
  source: CallbackSource;
  sources: CallbackSource[];
  firstMissedAt: Date;
  lastMissedAt: Date;
  missedCount: Generated<number>;
  /** Failed call back attempts since the citizen's latest missed call (drives the "unreachable" chip). */
  outboundAttempts: Generated<number>;
  lastOutboundAt: Date | null;
  lastOutboundExtension: string | null;
  lastOutboundCause: OutboundFailureCause | null;
  assignedUserId: number | null;
  assignedAt: Date | null;
  closedAt: Date | null;
  closedByUserId: number | null;
  closedByLabel: string | null;
  closeMethod: CallbackCloseMethod | null;
  resolutionType: CallbackResolutionType | null;
  closeReason: string | null;
  resolvedCallId: string | null;
  resolvedExtension: string | null;
  resolvedTalkSeconds: number | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface CallbackEventsTable {
  id: Generated<number>;
  callbackId: number;
  kind: CallbackEventKind;
  at: Date;
  source: CallbackSource | null;
  callId: string | null;
  extension: string | null;
  cause: OutboundFailureCause | null;
  talkSeconds: number | null;
  text: string | null;
  actorUserId: number | null;
  actorLabel: Generated<string>;
  createdAt: Generated<Date>;
}

export type CallbackRow = Selectable<CallbacksTable>;

declare module '../../database/db.js' {
  interface DB {
    callbackSettings: CallbackSettingsTable;
    callbacks: CallbacksTable;
    callbackEvents: CallbackEventsTable;
  }
}
