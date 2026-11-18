import type {
  CallAttemptStatus,
  CallbackOutcome,
  TicketAttachmentKind,
  TicketCloseOutcome,
  TicketEventKind,
  TicketRecordingStatus,
  TicketResolution,
  TicketStatus,
} from '@cc/shared';
import type { Generated, Selectable } from 'kysely';

export interface TicketsTable {
  id: Generated<number>;
  status: Generated<TicketStatus>;
  description: Generated<string>;
  customerPhone: string | null;
  customerName: string | null;
  regionId: number | null;
  cityId: number | null;
  categoryId: number | null;
  originCallId: string | null;
  creatorUserId: number | null;
  creatorLabel: string;
  creatorExtension: string | null;
  assigneeUserId: number | null;
  assigneeLabel: string | null;
  assigneeExtension: string | null;
  assignedAt: Date | null;
  startedAt: Date | null;
  resolution: TicketResolution | null;
  resolutionNote: string | null;
  resolvedByUserId: number | null;
  resolvedByLabel: string | null;
  resolvedByExtension: string | null;
  resolvedAt: Date | null;
  dueAt: Date | null;
  closedAt: Date | null;
  closedByUserId: number | null;
  closedByLabel: string | null;
  closedByExtension: string | null;
  callbackOutcome: TicketCloseOutcome | null;
  callbackNote: string | null;
  callbackAttempts: Generated<number>;
  /** Callback SLA: done/rejected + TICKETS_CALLBACK_SLA_WORKING_DAYS working days. */
  callbackDueAt: Date | null;
  /** Users who made a callback attempt (they keep read access after the ticket is closed). */
  callbackUserIds: Generated<number[]>;
  lastContactUserId: number | null;
  lastContactLabel: string | null;
  lastContactExtension: string | null;
  lastContactAt: Date | null;
  regionChangedAt: Generated<Date>;
  version: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface TicketCommentsTable {
  id: Generated<number>;
  ticketId: number;
  authorUserId: number | null;
  authorLabel: string;
  authorExtension: string | null;
  body: Generated<string>;
  isSystem: Generated<boolean>;
  createdAt: Generated<Date>;
}

export interface TicketAttachmentsTable {
  id: Generated<number>;
  ticketId: number;
  commentId: number | null;
  storageKey: string;
  fileName: string;
  mimeType: string;
  kind: TicketAttachmentKind;
  sizeBytes: number;
  uploadedByUserId: number | null;
  createdAt: Generated<Date>;
}

export interface TicketEventsTable {
  id: Generated<number>;
  ticketId: number;
  kind: TicketEventKind;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  fromRegionId: number | null;
  toRegionId: number | null;
  actorUserId: number | null;
  actorLabel: string | null;
  actorExtension: string | null;
  note: string | null;
  createdAt: Generated<Date>;
}

export interface TicketCallsTable {
  id: Generated<number>;
  ticketId: number;
  kind: 'origin' | 'callback';
  callId: string | null;
  phone: string | null;
  extension: string | null;
  userId: number | null;
  userLabel: string | null;
  startedAt: Generated<Date>;
  answeredAt: Date | null;
  endedAt: Date | null;
  talkSeconds: number | null;
  attemptStatus: CallAttemptStatus | null;
  outcome: CallbackOutcome | null;
  outcomeNote: string | null;
  outcomeAt: Date | null;
  recordingStatus: Generated<TicketRecordingStatus>;
  recordingPath: string | null;
  recordingChecks: Generated<number>;
  recordingNextAt: Generated<Date>;
  recordingDeadline: Date;
  createdAt: Generated<Date>;
}

export interface TicketReadsTable {
  userId: number;
  ticketId: number;
  readAt: Generated<Date>;
}

export interface TicketRegionsTable {
  id: Generated<number>;
  code: string;
  nameUz: string;
  nameRu: string;
  sortOrder: Generated<number>;
  isActive: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface TicketCitiesTable {
  id: Generated<number>;
  regionId: number;
  nameUz: string;
  nameRu: string;
  isActive: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface TicketCategoriesTable {
  id: Generated<number>;
  nameUz: string;
  nameRu: string;
  sortOrder: Generated<number>;
  isActive: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface TicketExecutiveRegionsTable {
  userId: number;
  regionId: number;
  createdAt: Generated<Date>;
}

export type TicketRow = Selectable<TicketsTable>;
export type TicketCommentRow = Selectable<TicketCommentsTable>;
export type TicketAttachmentRow = Selectable<TicketAttachmentsTable>;
export type TicketEventRow = Selectable<TicketEventsTable>;
export type TicketCallRow = Selectable<TicketCallsTable>;
export type TicketRegionRow = Selectable<TicketRegionsTable>;
export type TicketCityRow = Selectable<TicketCitiesTable>;
export type TicketCategoryRow = Selectable<TicketCategoriesTable>;

declare module '../../database/db.js' {
  interface DB {
    tickets: TicketsTable;
    ticketComments: TicketCommentsTable;
    ticketAttachments: TicketAttachmentsTable;
    ticketEvents: TicketEventsTable;
    ticketCalls: TicketCallsTable;
    ticketReads: TicketReadsTable;
    ticketRegions: TicketRegionsTable;
    ticketCities: TicketCitiesTable;
    ticketCategories: TicketCategoriesTable;
    ticketExecutiveRegions: TicketExecutiveRegionsTable;
  }
}
