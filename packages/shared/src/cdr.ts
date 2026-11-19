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

/**
 * History filter: a direction, "transfer" = calls that were transferred between operators, or
 * "external" = inbound + outbound (no internal calls; the dashboard's "Jami" card).
 */
export const CallDirectionFilterSchema = z.enum([...CALL_DIRECTIONS, 'transfer', 'external']);
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

/**
 * Why an operator whose phone rang never talked on a call (docs/rewrite/METRICS.md §1.2):
 *  no_answer — the ring ended without an answer (CDR `NO ANSWER`: ring timeout, the caller left, the queue moved on);
 *  rejected  — the operator declined after ringing at least 1 s (CDR `BUSY` with duration ≥ 1).
 * An offline phone (CONGESTION) or one busy at once (BUSY in under a second: already on a call) did not ring: no miss.
 */
export const MissReasonSchema = z.enum(['no_answer', 'rejected']);
export type MissReason = z.infer<typeof MissReasonSchema>;

/** One operator who missed a call: once per call, `rejected` when they both let it ring out and declined it. */
export const CallMissSchema = z.object({ ext: z.string(), reason: MissReasonSchema });
export type CallMiss = z.infer<typeof CallMissSchema>;

/** History filter: calls an operator missed (`missedBy` not empty) for any reason, or for one reason. */
export const OperatorMissFilterSchema = z.enum(['any', ...MissReasonSchema.options]);
export type OperatorMissFilter = z.infer<typeof OperatorMissFilterSchema>;

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
  /** Operators whose phone rang and who never talked on the call, with why (inbound). */
  missedBy: z.array(CallMissSchema),
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
    /** Calls an operator missed; together with `operator`, the calls THAT operator missed (not the ones they took). */
    operatorMiss: OperatorMissFilterSchema.optional(),
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

export const CdrCallIdSchema = z
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
