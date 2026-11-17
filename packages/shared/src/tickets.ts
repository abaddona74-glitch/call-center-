import { z } from 'zod';
import { IsoDateSchema } from './common.js';
import type { TicketActorKind, TicketCapabilities } from './ticket-access.js';

/**
 * Tickets: operator → regional executive → callback to the citizen (docs/rewrite/TICKETS.md).
 *
 *   new ──assign──▶ assigned ──start──▶ in_progress ──resolve──▶ done ─────┐
 *    ▲                 │                     │      ──reject───▶ rejected ─┤ (automatic "return")
 *    └──── forward ────┴─────────────────────┘                             ▼
 *          (another region, back to `new`)                         callback_pending ──close──▶ closed
 *
 * `close` needs a conversation of at least CALLBACK_MIN_TALK_SECONDS with the ticket's number,
 * confirmed by AMI, plus the operator's outcome. "Not reached" records an attempt and the ticket
 * stays in the shared callback queue.
 */
export const TICKET_STATUSES = ['new', 'assigned', 'in_progress', 'done', 'rejected', 'callback_pending', 'closed'] as const;
export const TicketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

/** `return` is done by the system right after done/rejected; `close` by an operator (or superuser). */
export const TICKET_ACTIONS = ['assign', 'start', 'resolve', 'reject', 'forward', 'return', 'close'] as const;
export const TicketActionSchema = z.enum(TICKET_ACTIONS);
export type TicketAction = z.infer<typeof TicketActionSchema>;

export const TicketResolutionSchema = z.enum(['done', 'rejected']);
export type TicketResolution = z.infer<typeof TicketResolutionSchema>;

/** What the operator tells after calling the citizen back. */
export const CALLBACK_OUTCOMES = ['informed', 'unresolved', 'other', 'not_reached'] as const;
export const CallbackOutcomeSchema = z.enum(CALLBACK_OUTCOMES);
export type CallbackOutcome = z.infer<typeof CallbackOutcomeSchema>;
/** How a ticket was closed: an operator's outcome, or `forced` (superuser, without a confirmed call). */
export const TicketCloseOutcomeSchema = z.enum([...CALLBACK_OUTCOMES, 'forced']);
export type TicketCloseOutcome = z.infer<typeof TicketCloseOutcomeSchema>;

/** A callback closes the ticket only after a conversation at least this long (owner decision). */
export const CALLBACK_MIN_TALK_SECONDS = 10;

/** dialing → answered → connected (≥ CALLBACK_MIN_TALK_SECONDS) | not_connected; failed = Originate refused. */
export const CallAttemptStatusSchema = z.enum(['dialing', 'answered', 'connected', 'not_connected', 'failed']);
export type CallAttemptStatus = z.infer<typeof CallAttemptStatusSchema>;

export const TicketRecordingStatusSchema = z.enum(['pending', 'found', 'none', 'unavailable']);
export type TicketRecordingStatus = z.infer<typeof TicketRecordingStatusSchema>;

export const TICKET_EVENT_KINDS = [
  'created',
  'assigned',
  'started',
  'done',
  'rejected',
  'returned',
  'forwarded',
  'callback_attempt',
  'closed',
] as const;
export const TicketEventKindSchema = z.enum(TICKET_EVENT_KINDS);
export type TicketEventKind = z.infer<typeof TicketEventKindSchema>;

/** Allowed attachment types: images, PDF, DOCX. Detected from file content, not the name. */
export const TicketAttachmentKindSchema = z.enum(['image', 'pdf', 'docx']);
export type TicketAttachmentKind = z.infer<typeof TicketAttachmentKindSchema>;
export const TICKET_ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,.docx';
export const TICKET_MAX_FILES_PER_UPLOAD = 10;

const Id = z.coerce.number().int().positive().max(2 ** 31);
export const TicketIdSchema = Id;
export const TicketAttachmentIdSchema = Id;
export const TicketCallRowIdSchema = Id;
export const DirectoryIdSchema = Id;

export function ticketCode(id: number): string {
  return `TK-${id}`;
}

// ---------------------------------------------------------------------------------------------
// Directories (edited by the superuser)
// ---------------------------------------------------------------------------------------------

const NameSchema = z.string().trim().min(2).max(120);

export const TicketRegionSchema = z.object({
  id: z.number().int(),
  /** Stable latin slug, e.g. "toshkent-shahri". */
  code: z.string(),
  nameUz: z.string(),
  nameRu: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type TicketRegion = z.infer<typeof TicketRegionSchema>;

export const TicketCitySchema = z.object({
  id: z.number().int(),
  regionId: z.number().int(),
  nameUz: z.string(),
  nameRu: z.string(),
  isActive: z.boolean(),
});
export type TicketCity = z.infer<typeof TicketCitySchema>;

export const TicketCategorySchema = z.object({
  id: z.number().int(),
  nameUz: z.string(),
  nameRu: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type TicketCategory = z.infer<typeof TicketCategorySchema>;

export const TicketDirectoriesSchema = z.object({
  regions: z.array(TicketRegionSchema.extend({ cities: z.array(TicketCitySchema) })),
  categories: z.array(TicketCategorySchema),
});
export type TicketDirectories = z.infer<typeof TicketDirectoriesSchema>;

export const RegionInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Latin lowercase letters, digits and dashes')
    .max(60),
  nameUz: NameSchema,
  nameRu: NameSchema,
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  isActive: z.boolean().default(true),
});
export type RegionInput = z.input<typeof RegionInputSchema>;
export const RegionPatchSchema = RegionInputSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type RegionPatch = z.infer<typeof RegionPatchSchema>;

export const CityInputSchema = z.object({
  nameUz: NameSchema,
  nameRu: NameSchema,
  isActive: z.boolean().default(true),
});
export type CityInput = z.input<typeof CityInputSchema>;
export const CityPatchSchema = CityInputSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type CityPatch = z.infer<typeof CityPatchSchema>;

export const CategoryInputSchema = z.object({
  nameUz: NameSchema,
  nameRu: NameSchema,
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.input<typeof CategoryInputSchema>;
export const CategoryPatchSchema = CategoryInputSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type CategoryPatch = z.infer<typeof CategoryPatchSchema>;

export const TicketExecutiveSchema = z.object({
  userId: z.number().int(),
  username: z.string(),
  extension: z.string().nullable(),
  /** PBX name when known. */
  name: z.string().nullable(),
  regionIds: z.array(z.number().int()),
});
export type TicketExecutive = z.infer<typeof TicketExecutiveSchema>;

export const SetExecutiveRegionsSchema = z.object({
  regionIds: z.array(z.number().int().positive()).max(50),
});
export type SetExecutiveRegions = z.infer<typeof SetExecutiveRegionsSchema>;

// ---------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------

export const TicketPersonSchema = z.object({
  userId: z.number().int().nullable(),
  /** Display label snapshot (PBX name / username) at the time of the action. */
  label: z.string(),
  extension: z.string().nullable(),
});
export type TicketPerson = z.infer<typeof TicketPersonSchema>;

export const TicketRefSchema = z.object({ id: z.number().int(), nameUz: z.string(), nameRu: z.string() });
export type TicketRef = z.infer<typeof TicketRefSchema>;

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

/** What the current viewer may do (computed on the server; the server checks again on every action). */
export const TicketActionsSchema = z.object({
  assign: z.boolean(),
  start: z.boolean(),
  resolve: z.boolean(),
  reject: z.boolean(),
  forward: z.boolean(),
  comment: z.boolean(),
  /** Start a callback call (click-to-call to the ticket's number). */
  call: z.boolean(),
  /** Record the outcome of my latest callback attempt. */
  recordOutcome: z.boolean(),
  /** Superuser: close without a confirmed conversation (with a reason). */
  forceClose: z.boolean(),
  delete: z.boolean(),
});
export type TicketActions = z.infer<typeof TicketActionsSchema>;

export const TicketLastContactSchema = TicketPersonSchema.extend({ at: z.string() });
export type TicketLastContact = z.infer<typeof TicketLastContactSchema>;

export const TicketSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  status: TicketStatusSchema,
  description: z.string(),
  /** normalizeUzPhone form; null only for migrated legacy tickets without a number. */
  customerPhone: z.string().nullable(),
  customerName: z.string().nullable(),
  region: TicketRefSchema.nullable(),
  city: TicketRefSchema.nullable(),
  category: TicketRefSchema.nullable(),
  /** No region yet (migrated legacy tickets): only the superuser sees it until it is routed. */
  needsTriage: z.boolean(),
  creator: TicketPersonSchema,
  assignee: TicketPersonSchema.nullable(),
  assignedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  resolution: TicketResolutionSchema.nullable(),
  resolutionNote: z.string().nullable(),
  resolvedBy: TicketPersonSchema.nullable(),
  resolvedAt: z.string().nullable(),
  /** SLA: created + N working days (Mon–Fri, holidays, Asia/Tashkent). */
  dueAt: z.string().nullable(),
  overdue: z.boolean(),
  closedAt: z.string().nullable(),
  closedBy: TicketPersonSchema.nullable(),
  callbackOutcome: TicketCloseOutcomeSchema.nullable(),
  callbackNote: z.string().nullable(),
  callbackAttempts: z.number().int(),
  /** The operator who last talked to this citizen (ticket call, callback or a later call). */
  lastContact: TicketLastContactSchema.nullable(),
  lastContactIsMe: z.boolean(),
  originCallId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  attachmentCount: z.number().int(),
  commentCount: z.number().int(),
  /** Executive: a new ticket of my region I have not opened yet. */
  unread: z.boolean(),
  actions: TicketActionsSchema,
});
export type Ticket = z.infer<typeof TicketSchema>;

export const TicketEventSchema = z.object({
  id: z.number().int(),
  kind: TicketEventKindSchema,
  fromStatus: TicketStatusSchema.nullable(),
  toStatus: TicketStatusSchema.nullable(),
  fromRegion: TicketRefSchema.nullable(),
  toRegion: TicketRefSchema.nullable(),
  /** null = the system (automatic step). */
  actor: TicketPersonSchema.nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type TicketEvent = z.infer<typeof TicketEventSchema>;

export const TicketCallSchema = z.object({
  id: z.number().int(),
  /** origin = the call the ticket was opened from; callback = an operator's call back. */
  kind: z.enum(['origin', 'callback']),
  callId: z.string().nullable(),
  phone: z.string().nullable(),
  operator: TicketPersonSchema.nullable(),
  startedAt: z.string(),
  answeredAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  talkSeconds: z.number().int().nullable(),
  /** Callback attempts only. */
  attemptStatus: CallAttemptStatusSchema.nullable(),
  outcome: CallbackOutcomeSchema.nullable(),
  outcomeNote: z.string().nullable(),
  recording: z.object({
    status: TicketRecordingStatusSchema,
    fileName: z.string().nullable(),
  }),
});
export type TicketCall = z.infer<typeof TicketCallSchema>;

export const TicketDetailSchema = TicketSchema.extend({
  attachments: z.array(TicketAttachmentSchema),
  comments: z.array(TicketCommentSchema),
  events: z.array(TicketEventSchema),
  calls: z.array(TicketCallSchema),
});
export type TicketDetail = z.infer<typeof TicketDetailSchema>;

/**
 * mine     — operator: tickets I opened; executive: assigned to me (not closed); superuser: opened or assigned to me
 * queue    — `new` tickets of my regions (superuser: all regions)
 * callback — the shared callback queue (`callback_pending`), my citizens first
 * triage   — superuser: tickets without a region
 * all      — everything I may see
 */
export const TICKET_VIEWS = ['all', 'mine', 'queue', 'callback', 'triage'] as const;
export const TicketViewSchema = z.enum(TICKET_VIEWS);
export type TicketView = z.infer<typeof TicketViewSchema>;

const queryBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const TicketListQuerySchema = z.object({
  view: TicketViewSchema.default('all'),
  status: TicketStatusSchema.optional(),
  regionId: Id.optional(),
  categoryId: Id.optional(),
  overdue: queryBool.optional(),
  /** TK-number, number fragment of the phone, or text in the description / name. */
  q: z.string().trim().max(60).optional(),
});
export type TicketListQuery = z.input<typeof TicketListQuerySchema>;
export type TicketListQueryParsed = z.output<typeof TicketListQuerySchema>;

export const TicketCountsSchema = z.object({
  all: z.number().int(),
  mine: z.number().int(),
  queue: z.number().int(),
  callback: z.number().int(),
  triage: z.number().int(),
  overdue: z.number().int(),
});
export type TicketCounts = z.infer<typeof TicketCountsSchema>;

export const TicketListResponseSchema = z.object({
  items: z.array(TicketSchema),
  counts: TicketCountsSchema,
});
export type TicketListResponse = z.infer<typeof TicketListResponseSchema>;

export const TicketContextSchema = z.object({
  kind: z.enum(['superuser', 'executive', 'observer', 'operator', 'none']) satisfies z.ZodType<TicketActorKind>,
  capabilities: z.object({
    viewAll: z.boolean(),
    create: z.boolean(),
    work: z.boolean(),
    callback: z.boolean(),
    comment: z.boolean(),
    manageDirectories: z.boolean(),
    reports: z.boolean(),
    administer: z.boolean(),
  }) satisfies z.ZodType<TicketCapabilities>,
  /** Executive: regions I work for. */
  regionIds: z.array(z.number().int()),
  maxFileMb: z.number().int(),
  slaWorkingDays: z.number().int(),
  unread: z.number().int(),
});
export type TicketContext = z.infer<typeof TicketContextSchema>;

export const TicketUnreadSchema = z.object({ count: z.number().int() });
export type TicketUnread = z.infer<typeof TicketUnreadSchema>;

const formId = z.union([z.literal(''), Id]).transform((v) => (v === '' ? null : v));

const PhoneFieldSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[0-9+()\s-]*$/, 'Phone may contain digits, spaces, + ( ) -');

export const TICKET_DESCRIPTION_MAX = 4000;

/** Asterisk linkedid / uniqueid, e.g. "1763370000.42". */
const CallRefSchema = z.string().trim().regex(/^[0-9]{1,20}\.[0-9]{1,10}$/, 'Invalid call id');

/**
 * multipart/form-data fields of POST /tickets (files go in `files`).
 * With `callId` the phone comes from the call (live state, or the CDR for a past call) — `phone` is ignored.
 */
export const CreateTicketFieldsSchema = z.object({
  callId: z.union([z.literal(''), CallRefSchema]).optional(),
  phone: PhoneFieldSchema.optional(),
  customerName: z.string().trim().max(120).optional(),
  regionId: Id,
  cityId: formId.optional(),
  categoryId: Id,
  description: z.string().trim().min(3).max(TICKET_DESCRIPTION_MAX),
});
export type CreateTicketFields = z.input<typeof CreateTicketFieldsSchema>;
export type CreateTicketFieldsParsed = z.output<typeof CreateTicketFieldsSchema>;

/** GET /tickets/call-prefill?callId= — what the create form shows for a call. */
export const TicketCallPrefillQuerySchema = z.object({ callId: CallRefSchema });
export const TicketCallPrefillSchema = z.object({
  callId: z.string(),
  source: z.enum(['live', 'history']),
  phone: z.string().nullable(),
  startedAt: z.string().nullable(),
  /** Open tickets of this number (to avoid duplicates). */
  openTickets: z.array(z.object({ id: z.number().int(), code: z.string(), status: TicketStatusSchema })),
});
export type TicketCallPrefill = z.infer<typeof TicketCallPrefillSchema>;

export const ResolveTicketRequestSchema = z.object({ note: z.string().trim().max(2000).optional() });
export type ResolveTicketRequest = z.infer<typeof ResolveTicketRequestSchema>;

export const RejectTicketRequestSchema = z.object({ note: z.string().trim().min(2).max(2000) });
export type RejectTicketRequest = z.infer<typeof RejectTicketRequestSchema>;

export const ForwardTicketRequestSchema = z.object({
  regionId: z.number().int().positive(),
  note: z.string().trim().max(1000).optional(),
});
export type ForwardTicketRequest = z.infer<typeof ForwardTicketRequestSchema>;

export const CallbackOutcomeRequestSchema = z.object({
  outcome: CallbackOutcomeSchema,
  note: z.string().trim().max(1000).optional(),
});
export type CallbackOutcomeRequest = z.infer<typeof CallbackOutcomeRequestSchema>;

export const ForceCloseTicketRequestSchema = z.object({ note: z.string().trim().min(2).max(1000) });
export type ForceCloseTicketRequest = z.infer<typeof ForceCloseTicketRequestSchema>;

/** multipart/form-data fields of POST /tickets/:id/comments. */
export const AddTicketCommentFieldsSchema = z.object({
  body: z.string().trim().max(TICKET_DESCRIPTION_MAX).default(''),
});
export type AddTicketCommentFields = z.input<typeof AddTicketCommentFieldsSchema>;
export type AddTicketCommentFieldsParsed = z.output<typeof AddTicketCommentFieldsSchema>;

/** Sanitized HTML of a DOCX attachment (rendered server-side with mammoth). */
export const TicketDocPreviewSchema = z.object({ html: z.string() });
export type TicketDocPreview = z.infer<typeof TicketDocPreviewSchema>;

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------

export const TicketReportQuerySchema = z.object({ from: IsoDateSchema, to: IsoDateSchema });
export type TicketReportQuery = z.infer<typeof TicketReportQuerySchema>;

export const TicketReportRowSchema = z.object({
  /** Region / category id, executive user id; null = not set. */
  id: z.number().int().nullable(),
  nameUz: z.string(),
  nameRu: z.string(),
  total: z.number().int(),
  /** Reached done / rejected (or later). */
  resolved: z.number().int(),
  overdue: z.number().int(),
  /** Average created → done/rejected, hours. */
  avgResolutionHours: z.number().nullable(),
});
export type TicketReportRow = z.infer<typeof TicketReportRowSchema>;

export const TicketReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  total: z.number().int(),
  resolved: z.number().int(),
  closed: z.number().int(),
  overdue: z.number().int(),
  /** overdue / total (0 when there are no tickets). */
  overdueShare: z.number(),
  avgResolutionHours: z.number().nullable(),
  byStatus: z.array(z.object({ status: TicketStatusSchema, count: z.number().int() })),
  byRegion: z.array(TicketReportRowSchema),
  byCategory: z.array(TicketReportRowSchema),
  byExecutive: z.array(TicketReportRowSchema),
});
export type TicketReport = z.infer<typeof TicketReportSchema>;
