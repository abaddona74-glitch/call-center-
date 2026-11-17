import type { TicketAttachmentKind, TicketStatus } from '@cc/shared';
import type { Generated, Selectable } from 'kysely';

export interface TicketsTable {
  id: Generated<number>;
  status: Generated<TicketStatus>;
  body: Generated<string>;
  customerPhone: string | null;
  isUrgent: Generated<boolean>;
  creatorUserId: number | null;
  creatorLabel: string;
  creatorExtension: string | null;
  creatorParty: 'admin' | 'creator';
  targetAll: Generated<boolean>;
  targetUserId: number | null;
  targetLabel: string | null;
  targetExtension: string | null;
  assigneeUserId: number | null;
  assigneeLabel: string | null;
  assigneeExtension: string | null;
  acceptedAt: Date | null;
  completedByUserId: number | null;
  completedByLabel: string | null;
  completedByExtension: string | null;
  completedAt: Date | null;
  rejectedByUserId: number | null;
  rejectedByLabel: string | null;
  rejectedByExtension: string | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
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

export type TicketRow = Selectable<TicketsTable>;
export type TicketCommentRow = Selectable<TicketCommentsTable>;
export type TicketAttachmentRow = Selectable<TicketAttachmentsTable>;

declare module '../../database/db.js' {
  interface DB {
    tickets: TicketsTable;
    ticketComments: TicketCommentsTable;
    ticketAttachments: TicketAttachmentsTable;
  }
}
