import { z } from 'zod';

/**
 * Operator tickets (the legacy viewer "KDS board").
 *
 * Who is who (decided on the server from the session user, never from the request):
 *  - admin    — admin/superuser: sees and may do everything;
 *  - creator  — operators of the "200" group (extension >= TICKETS_CREATOR_EXTENSION_FROM): open tickets;
 *  - receiver — other operators with an extension: accept / reject / complete tickets addressed
 *               to them or to everyone;
 *  - none     — users without an extension: no access.
 *
 * State machine:  open ──accept──▶ accepted ──complete──▶ completed
 *                   │                  │
 *                   └──reject──▶ rejected ◀──reject──┘      rejected ──accept──▶ accepted
 */
export const TICKET_STATUSES = ['open', 'accepted', 'completed', 'rejected'] as const;
export const TicketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const TICKET_TRANSITIONS = ['accept', 'reject', 'complete'] as const;
export const TicketTransitionSchema = z.enum(TICKET_TRANSITIONS);
export type TicketTransition = z.infer<typeof TicketTransitionSchema>;

export const TicketPartySchema = z.enum(['admin', 'creator', 'receiver', 'none']);
export type TicketParty = z.infer<typeof TicketPartySchema>;

export const TICKET_FILTERS = ['all', 'mine', 'open', 'accepted', 'completed', 'rejected'] as const;
export const TicketFilterSchema = z.enum(TICKET_FILTERS);
export type TicketFilter = z.infer<typeof TicketFilterSchema>;

/** Allowed attachment types: images, PDF, DOCX. Detected from file content, not the name. */
export const TicketAttachmentKindSchema = z.enum(['image', 'pdf', 'docx']);
export type TicketAttachmentKind = z.infer<typeof TicketAttachmentKindSchema>;
export const TICKET_ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,.docx';
export const TICKET_MAX_FILES_PER_UPLOAD = 10;

export const TicketIdSchema = z.coerce.number().int().positive().max(2 ** 31);
export const TicketAttachmentIdSchema = z.coerce.number().int().positive().max(2 ** 31);

export function ticketCode(id: number): string {
  return `TK-${id}`;
}

export const TicketPersonSchema = z.object({
  userId: z.number().int().nullable(),
  /** Display label snapshot (username / PBX name) at the time of the action. */
  label: z.string(),
  extension: z.string().nullable(),
});
export type TicketPerson = z.infer<typeof TicketPersonSchema>;

export const TicketAttachmentSchema = z.object({
  id: z.number().int(),
  fileName: z.string(),
  mimeType: z.string(),
  kind: TicketAttachmentKindSchema,
  size: z.number().int(),
  createdAt: z.string(),
});
export type TicketAttachment = z.infer<typeof TicketAttachmentSchema>;

export const TicketCommentSchema = z.object({
  id: z.number().int(),
  author: TicketPersonSchema,
  body: z.string(),
  isSystem: z.boolean(),
  createdAt: z.string(),
  attachments: z.array(TicketAttachmentSchema),
});
export type TicketComment = z.infer<typeof TicketCommentSchema>;

/** What the current viewer may do with the ticket (computed on the server). */
export const TicketPermissionsSchema = z.object({
  accept: z.boolean(),
  reject: z.boolean(),
  complete: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
  comment: z.boolean(),
});
export type TicketPermissions = z.infer<typeof TicketPermissionsSchema>;

export const TicketSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  status: TicketStatusSchema,
  body: z.string(),
  customerPhone: z.string().nullable(),
  isUrgent: z.boolean(),
  creator: TicketPersonSchema,
  /** null = addressed to every receiver ("Barcha operatorlar"). */
  target: TicketPersonSchema.nullable(),
  /** Who accepted the ticket. */
  assignee: TicketPersonSchema.nullable(),
  acceptedAt: z.string().nullable(),
  completedBy: TicketPersonSchema.nullable(),
  completedAt: z.string().nullable(),
  rejectedBy: TicketPersonSchema.nullable(),
  rejectedAt: z.string().nullable(),
  rejectReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  attachments: z.array(TicketAttachmentSchema),
  commentCount: z.number().int(),
  permissions: TicketPermissionsSchema,
});
export type Ticket = z.infer<typeof TicketSchema>;

export const TicketDetailSchema = TicketSchema.extend({
  comments: z.array(TicketCommentSchema),
});
export type TicketDetail = z.infer<typeof TicketDetailSchema>;

export const TicketStatsSchema = z.object({
  all: z.number().int(),
  mine: z.number().int(),
  open: z.number().int(),
  accepted: z.number().int(),
  completed: z.number().int(),
  rejected: z.number().int(),
});
export type TicketStats = z.infer<typeof TicketStatsSchema>;

export const TicketListQuerySchema = z.object({
  filter: TicketFilterSchema.default('all'),
});
export type TicketListQuery = z.infer<typeof TicketListQuerySchema>;

export const TicketListResponseSchema = z.object({
  items: z.array(TicketSchema),
  stats: TicketStatsSchema,
});
export type TicketListResponse = z.infer<typeof TicketListResponseSchema>;

export const TicketAssigneeSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  extension: z.string(),
  /** Name from the PBX (asterisk.users) when available. */
  name: z.string().nullable(),
});
export type TicketAssignee = z.infer<typeof TicketAssigneeSchema>;

export const TicketContextSchema = z.object({
  party: TicketPartySchema,
  canCreate: z.boolean(),
  canCleanup: z.boolean(),
  /** Completed tickets older than this many days are purged automatically (0 = never). */
  purgeCompletedAfterDays: z.number().int(),
  assignees: z.array(TicketAssigneeSchema),
});
export type TicketContext = z.infer<typeof TicketContextSchema>;

const formBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'on'])])
  .transform((v) => v === true || v === 'true' || v === '1' || v === 'on');

const PhoneFieldSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[0-9+()\s-]*$/, 'Phone may contain digits, spaces, + ( ) -')
  .transform((v) => (v === '' ? null : v));

const TargetFieldSchema = z
  .union([z.literal('all'), z.literal(''), z.coerce.number().int().positive()])
  .transform((v) => (v === 'all' || v === '' ? null : v));

export const TICKET_BODY_MAX = 4000;

/** multipart/form-data fields of POST /tickets (files go in `files`). */
export const CreateTicketFieldsSchema = z.object({
  body: z.string().trim().max(TICKET_BODY_MAX).default(''),
  customerPhone: PhoneFieldSchema.optional(),
  isUrgent: formBool.optional(),
  /** User id of a receiver, or "all". */
  targetUserId: TargetFieldSchema.optional(),
});
export type CreateTicketFields = z.input<typeof CreateTicketFieldsSchema>;

export const UpdateTicketRequestSchema = z
  .object({
    body: z.string().trim().min(1).max(TICKET_BODY_MAX).optional(),
    customerPhone: PhoneFieldSchema.nullable().optional(),
    isUrgent: z.boolean().optional(),
    targetUserId: z.number().int().positive().nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');
export type UpdateTicketRequest = z.infer<typeof UpdateTicketRequestSchema>;

export const RejectTicketRequestSchema = z.object({
  reason: z.string().trim().min(2).max(500),
});
export type RejectTicketRequest = z.infer<typeof RejectTicketRequestSchema>;

/** multipart/form-data fields of POST /tickets/:id/comments. */
export const AddTicketCommentFieldsSchema = z.object({
  body: z.string().trim().max(TICKET_BODY_MAX).default(''),
});
export type AddTicketCommentFields = z.input<typeof AddTicketCommentFieldsSchema>;

export const TicketCleanupResponseSchema = z.object({ removed: z.number().int() });
export type TicketCleanupResponse = z.infer<typeof TicketCleanupResponseSchema>;

/** Sanitized HTML of a DOCX attachment (rendered server-side with mammoth). */
export const TicketDocPreviewSchema = z.object({ html: z.string() });
export type TicketDocPreview = z.infer<typeof TicketDocPreviewSchema>;
