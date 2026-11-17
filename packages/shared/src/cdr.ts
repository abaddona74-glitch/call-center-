import { z } from 'zod';
import { IsoDateSchema } from './common.js';

/**
 * Call history read from the PBX CDR (asteriskcdrdb.cdr). One item = one call (all CDR legs that share
 * a linkedid). Definitions of direction/status/operator are in docs/rewrite/METRICS.md.
 */

export const CALL_DIRECTIONS = ['inbound', 'outbound', 'internal'] as const;
export const CallDirectionSchema = z.enum(CALL_DIRECTIONS);
export type CallDirection = z.infer<typeof CallDirectionSchema>;

/**
 * Final outcome of a call.
 * inbound:  answered | abandoned (reached the queue, nobody answered) | ivr (hung up in the IVR) |
 *           after_hours (outside the working calendar or the IVR played the off-hours announcement)
 * outbound / internal: answered | no_answer | busy | failed
 */
export const CALL_STATUSES = ['answered', 'abandoned', 'ivr', 'after_hours', 'no_answer', 'busy', 'failed'] as const;
export const CallStatusSchema = z.enum(CALL_STATUSES);
export type CallStatus = z.infer<typeof CallStatusSchema>;

/** History filter: a concrete status, or "missed" = every not-answered status. */
export const CallStatusFilterSchema = z.enum([...CALL_STATUSES, 'missed']);
export type CallStatusFilter = z.infer<typeof CallStatusFilterSchema>;

/** History filter: a direction, or "transfer" = calls that were transferred between operators. */
export const CallDirectionFilterSchema = z.enum([...CALL_DIRECTIONS, 'transfer']);
export type CallDirectionFilter = z.infer<typeof CallDirectionFilterSchema>;

/** "working" = only calls that started inside the working calendar (Mon–Fri 08:00–21:00 by default). */
export const CallScopeSchema = z.enum(['all', 'working']);
export type CallScope = z.infer<typeof CallScopeSchema>;

const ExtSchema = z.string().regex(/^[0-9]{2,6}$/);

export const CallOperatorSchema = z.object({
  ext: z.string(),
  name: z.string().nullable(),
});
export type CallOperator = z.infer<typeof CallOperatorSchema>;

export const CallTransferSchema = z.object({
  from: z.string().nullable(),
  to: z.string(),
  at: z.string(),
  answered: z.boolean(),
  talkSec: z.number().int(),
});
export type CallTransfer = z.infer<typeof CallTransferSchema>;

export const CallListItemSchema = z.object({
  /** Asterisk linkedid (uniqueid of the first leg when linkedid is empty). */
  id: z.string(),
  /** ISO-8601 with offset, Asia/Tashkent. */
  startedAt: z.string(),
  date: IsoDateSchema,
  /** HH:mm:ss, Asia/Tashkent. */
  time: z.string(),
  direction: CallDirectionSchema,
  status: CallStatusSchema,
  transferred: z.boolean(),
  /** Client number normalized with normalizeUzPhone (9-digit national form when possible). */
  clientNumber: z.string().nullable(),
  /** As written by the PBX (src for inbound, dst for outbound). */
  clientNumberRaw: z.string().nullable(),
  hiddenNumber: z.boolean(),
  /** Operator who finished the call (last operator in a transfer chain; the dialer for outbound). */
  operator: CallOperatorSchema.nullable(),
  /** Every operator who talked, in order. */
  operators: z.array(CallOperatorSchema),
  transfers: z.array(CallTransferSchema),
  /** Operators whose phone rang but who did not answer (inbound). */
  missedBy: z.array(z.string()),
  talkSec: z.number().int(),
  /** Inbound: queue entry → answer (answered) or → hang-up (abandoned). Null when not applicable. */
  waitSec: z.number().int().nullable(),
  durationSec: z.number().int(),
  inWorkingHours: z.boolean(),
  /** CDR does not say who hung up; real data comes from AMI (live module). */
  hangupBy: z.enum(['client', 'operator', 'unknown']),
  hasRecording: z.boolean(),
  /** Recording file name; null for operators (legacy never exposed recordings to them). */
  recordingFile: z.string().nullable(),
});
export type CallListItem = z.infer<typeof CallListItemSchema>;

const optionalString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const CallHistoryQuerySchema = z
  .object({
    /** Inclusive Asia/Tashkent dates. Both default to today; omit both with a phone `search` to search all days. */
    from: IsoDateSchema.optional(),
    to: IsoDateSchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(20),
    direction: CallDirectionFilterSchema.optional(),
    status: CallStatusFilterSchema.optional(),
    operator: ExtSchema.optional(),
    /** Phone in any format, an extension, or (part of) an operator name. */
    search: optionalString(100),
    scope: CallScopeSchema.default('all'),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });
export type CallHistoryQuery = z.infer<typeof CallHistoryQuerySchema>;

export const CallHistoryResponseSchema = z.object({
  items: z.array(CallListItemSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  /** Dates actually searched (for an all-days phone search: the days where the number appears). */
  range: z.object({ from: IsoDateSchema, to: IsoDateSchema, allDays: z.boolean() }),
});
export type CallHistoryResponse = z.infer<typeof CallHistoryResponseSchema>;

export const CallIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, 'Invalid call id');

/** One raw CDR row of a call, for the details view. */
export const CdrLegSchema = z.object({
  calldate: z.string(),
  src: z.string(),
  dst: z.string(),
  dcontext: z.string(),
  channel: z.string(),
  dstchannel: z.string(),
  lastapp: z.string(),
  lastdata: z.string(),
  disposition: z.string(),
  duration: z.number().int(),
  billsec: z.number().int(),
  uniqueid: z.string(),
});
export type CdrLeg = z.infer<typeof CdrLegSchema>;

export const CallDetailsResponseSchema = z.object({
  call: CallListItemSchema,
  legs: z.array(CdrLegSchema),
});
export type CallDetailsResponse = z.infer<typeof CallDetailsResponseSchema>;
