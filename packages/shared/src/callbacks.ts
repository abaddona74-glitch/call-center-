import { z } from 'zod';
import { IsoDateSchema } from './common.js';
import { normalizeUzPhone } from './phone.js';

/**
 * Callbacks: citizens the call center must call back (replaces legacy `pending_callbacks`).
 *
 * Rules (see apps/api/src/modules/callbacks/domain):
 * - one open (pending) callback per normalized phone; every missed call is an attempt on it;
 * - closed only by a real conversation (answered, talk >= minTalkSeconds) or manually with a reason;
 * - after-hours calls create callbacks with source `after_hours` and are never hidden.
 */

export const CALLBACK_STATUSES = ['pending', 'resolved', 'dismissed'] as const;
export const CallbackStatusSchema = z.enum(CALLBACK_STATUSES);
export type CallbackStatus = z.infer<typeof CallbackStatusSchema>;

/** Why the citizen needs a call back. */
export const CALLBACK_SOURCES = ['abandoned', 'after_hours', 'operator_missed'] as const;
export const CallbackSourceSchema = z.enum(CALLBACK_SOURCES);
export type CallbackSource = z.infer<typeof CallbackSourceSchema>;

/**
 * UI buckets (legacy chips): pending = nobody tried yet ("Kutilmoqda"), unreachable = operators tried
 * and failed ("Ulanilmadi"), resolved = talked ("Gaplashildi"), dismissed = closed manually.
 */
export const CALLBACK_CATEGORIES = ['pending', 'unreachable', 'resolved', 'dismissed'] as const;
export const CallbackCategorySchema = z.enum(CALLBACK_CATEGORIES);
export type CallbackCategory = z.infer<typeof CallbackCategorySchema>;

export const CALLBACK_CLOSE_METHODS = ['conversation', 'manual'] as const;
export const CallbackCloseMethodSchema = z.enum(CALLBACK_CLOSE_METHODS);
export type CallbackCloseMethod = z.infer<typeof CallbackCloseMethodSchema>;

/** Who called whom in the conversation that resolved the callback. */
export const CALLBACK_RESOLUTION_TYPES = ['client_inbound', 'operator_outbound'] as const;
export const CallbackResolutionTypeSchema = z.enum(CALLBACK_RESOLUTION_TYPES);
export type CallbackResolutionType = z.infer<typeof CallbackResolutionTypeSchema>;

/** Why an operator's call back attempt failed. */
export const OUTBOUND_FAILURE_CAUSES = ['no_answer', 'busy', 'rejected', 'unavailable', 'short_call'] as const;
export const OutboundFailureCauseSchema = z.enum(OUTBOUND_FAILURE_CAUSES);
export type OutboundFailureCause = z.infer<typeof OutboundFailureCauseSchema>;

export const CALLBACK_EVENT_KINDS = [
  'missed',
  'outbound_failed',
  'short_conversation',
  'resolved',
  'dismissed',
  'note',
  'assigned',
] as const;
export const CallbackEventKindSchema = z.enum(CALLBACK_EVENT_KINDS);
export type CallbackEventKind = z.infer<typeof CallbackEventKindSchema>;

const IsoDateTime = z.iso.datetime({ offset: true });

export const CallbackUserRefSchema = z.object({ id: z.number().int(), username: z.string() });
export type CallbackUserRef = z.infer<typeof CallbackUserRefSchema>;

export const CallbackSchema = z.object({
  id: z.number().int(),
  phone: z.string(),
  status: CallbackStatusSchema,
  category: CallbackCategorySchema,
  /** Source of the call that opened the callback. */
  source: CallbackSourceSchema,
  /** Every source seen among its missed calls (opening source first). */
  sources: z.array(CallbackSourceSchema),
  firstMissedAt: IsoDateTime,
  lastMissedAt: IsoDateTime,
  /** Missed calls from this citizen while the callback is open. */
  missedCount: z.number().int(),
  /** Of them, today (Asia/Tashkent). */
  missedToday: z.number().int(),
  outboundAttempts: z.number().int(),
  outboundAttemptsToday: z.number().int(),
  lastOutboundAt: IsoDateTime.nullable(),
  lastOutboundExtension: z.string().nullable(),
  lastOutboundCause: OutboundFailureCauseSchema.nullable(),
  assignee: CallbackUserRefSchema.nullable(),
  lastNote: z.object({ text: z.string(), at: IsoDateTime, author: z.string() }).nullable(),
  closedAt: IsoDateTime.nullable(),
  /** "ext 101" for conversations, username for manual closes. */
  closedBy: z.string().nullable(),
  closeMethod: CallbackCloseMethodSchema.nullable(),
  resolutionType: CallbackResolutionTypeSchema.nullable(),
  closeReason: z.string().nullable(),
  resolvedExtension: z.string().nullable(),
  resolvedTalkSeconds: z.number().int().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Callback = z.infer<typeof CallbackSchema>;

export const CallbackEventSchema = z.object({
  id: z.number().int(),
  kind: CallbackEventKindSchema,
  at: IsoDateTime,
  source: CallbackSourceSchema.nullable(),
  callId: z.string().nullable(),
  extension: z.string().nullable(),
  cause: OutboundFailureCauseSchema.nullable(),
  talkSeconds: z.number().int().nullable(),
  text: z.string().nullable(),
  /** Username for manual actions, "system" for automatic ones. */
  actor: z.string(),
});
export type CallbackEvent = z.infer<typeof CallbackEventSchema>;

export const CallbackDetailsSchema = z.object({
  callback: CallbackSchema,
  events: z.array(CallbackEventSchema),
});
export type CallbackDetails = z.infer<typeof CallbackDetailsSchema>;

/** `today` / `all` / a calendar date (Asia/Tashkent). */
export const CallbackDateFilterSchema = z.union([z.literal('today'), z.literal('all'), IsoDateSchema]);
export type CallbackDateFilter = z.infer<typeof CallbackDateFilterSchema>;

export const CallbackListQuerySchema = z.object({
  date: CallbackDateFilterSchema.default('today'),
  category: z.union([CallbackCategorySchema, z.literal('all')]).default('all'),
  source: CallbackSourceSchema.optional(),
  /** Digits typed by a user to narrow the list (display filter, not used for matching calls). */
  phone: z
    .string()
    .trim()
    .max(20)
    .transform((v) => v.replace(/\D/g, ''))
    .optional(),
  assignee: z.union([z.literal('me'), z.literal('none'), z.coerce.number().int().positive()]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});
export type CallbackListQuery = z.infer<typeof CallbackListQuerySchema>;
export type CallbackListQueryInput = z.input<typeof CallbackListQuerySchema>;

export const CallbackCountsSchema = z.object({
  pending: z.number().int(),
  unreachable: z.number().int(),
  resolved: z.number().int(),
  dismissed: z.number().int(),
});
export type CallbackCounts = z.infer<typeof CallbackCountsSchema>;

export const CallbackListResponseSchema = z.object({
  items: z.array(CallbackSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Counts per category for the same date/source/phone filter (chips). */
  counts: CallbackCountsSchema,
});
export type CallbackListResponse = z.infer<typeof CallbackListResponseSchema>;

const ReasonSchema = z
  .string()
  .trim()
  .min(3, 'Reason is required (at least 3 characters)')
  .max(500)
  .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), 'Control characters are not allowed');

export const CloseCallbackRequestSchema = z.object({ reason: ReasonSchema });
export type CloseCallbackRequest = z.infer<typeof CloseCallbackRequestSchema>;

export const DismissAllCallbacksRequestSchema = z.object({
  reason: ReasonSchema,
  /** Only callbacks whose last missed call is on this day; `all` = every pending callback. */
  date: CallbackDateFilterSchema.default('all'),
});
export type DismissAllCallbacksRequest = z.infer<typeof DismissAllCallbacksRequestSchema>;

export const DismissAllCallbacksResponseSchema = z.object({ dismissed: z.number().int() });
export type DismissAllCallbacksResponse = z.infer<typeof DismissAllCallbacksResponseSchema>;

export const AddCallbackNoteRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), 'Control characters are not allowed'),
});
export type AddCallbackNoteRequest = z.infer<typeof AddCallbackNoteRequestSchema>;

/** `userId: null` = unassign. Operators may only take a callback themselves or release their own. */
export const AssignCallbackRequestSchema = z.object({ userId: z.number().int().positive().nullable() });
export type AssignCallbackRequest = z.infer<typeof AssignCallbackRequestSchema>;

export const CallbackSyncRequestSchema = z.object({
  /** How far back to read the PBX CDR. */
  hours: z
    .number()
    .int()
    .min(1)
    .max(24 * 31)
    .default(48),
});
export type CallbackSyncRequest = z.infer<typeof CallbackSyncRequestSchema>;

export const CallbackSyncResultSchema = z.object({
  scannedRows: z.number().int(),
  calls: z.number().int(),
  created: z.number().int(),
  appended: z.number().int(),
  resolved: z.number().int(),
  failedAttempts: z.number().int(),
  skipped: z.number().int(),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime,
});
export type CallbackSyncResult = z.infer<typeof CallbackSyncResultSchema>;

const HhMmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

/** Working calendar and resolution threshold (Asia/Tashkent). Admin-editable, audited. */
export const CallbackSettingsSchema = z
  .object({
    /** ISO weekdays: 1 = Monday … 7 = Sunday. */
    workDays: z
      .array(z.number().int().min(1).max(7))
      .max(7)
      .refine((d) => new Set(d).size === d.length, 'Duplicate weekday'),
    workStart: HhMmSchema,
    workEnd: HhMmSchema,
    /** Non-working dates (public holidays). */
    holidays: z
      .array(
        IsoDateSchema.refine((d) => {
          const t = new Date(`${d}T00:00:00Z`);
          return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d);
        }, 'Not a real calendar date'),
      )
      .max(400)
      .refine((d) => new Set(d).size === d.length, 'Duplicate holiday'),
    /** A conversation shorter than this does not resolve a callback. */
    minTalkSeconds: z.number().int().min(1).max(600),
  })
  .refine((s) => s.workStart < s.workEnd, { message: 'workStart must be before workEnd', path: ['workEnd'] });
export type CallbackSettings = z.infer<typeof CallbackSettingsSchema>;

export const DEFAULT_CALLBACK_SETTINGS: CallbackSettings = {
  workDays: [1, 2, 3, 4, 5],
  workStart: '08:00',
  workEnd: '21:00',
  holidays: [],
  minTalkSeconds: 10,
};

/** Path/body phone: anything `normalizeUzPhone` accepts, returned normalized. */
export const UzPhoneInputSchema = z
  .string()
  .trim()
  .max(32)
  .transform((v, ctx) => {
    const n = normalizeUzPhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Invalid phone number' });
      return z.NEVER;
    }
    return n;
  });

export const PositiveIdParamSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
