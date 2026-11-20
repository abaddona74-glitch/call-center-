import { z } from 'zod';
import { ExtensionSchema, type Role } from './auth.js';
import { type Permission, hasPermission } from './permissions.js';
import { IsoDateSchema } from './common.js';

/**
 * Live telephony contracts (AMI-driven): operator presence board, active calls, queues,
 * today's live counters, AMI connection status and the telephony actions.
 *
 * Phone numbers are normalized with normalizeUzPhone() (9-digit national form) or null for
 * hidden callers. For viewers with the `operator` role, numbers of calls that are not on their
 * own extension are masked (see maskPhone) — the server does this, the UI only displays.
 */

/** Asterisk uniqueid / linkedid, e.g. "1763370000.42". */
export const CallIdSchema = z.string().regex(/^[0-9]{1,20}\.[0-9]{1,10}$/, 'Invalid call id');

export const OperatorPresenceSchema = z.enum(['idle', 'ringing', 'talking', 'paused', 'offline']);
export type OperatorPresence = z.infer<typeof OperatorPresenceSchema>;

export const LiveCallDirectionSchema = z.enum(['inbound', 'outbound', 'internal']);
export type LiveCallDirection = z.infer<typeof LiveCallDirectionSchema>;

/**
 * ivr     — inbound, not (yet) in a queue and not ringing anyone (IVR, announcements)
 * queued  — waiting in a queue, nobody is ringing
 * ringing — an operator's phone is ringing (inbound/internal)
 * dialing — outbound/click-to-call, the callee has not answered yet
 * talking — connected to an operator
 */
export const LiveCallStateSchema = z.enum(['ivr', 'queued', 'ringing', 'dialing', 'talking']);
export type LiveCallState = z.infer<typeof LiveCallStateSchema>;

export const OperatorCallSchema = z.object({
  callId: CallIdSchema,
  direction: LiveCallDirectionSchema,
  state: z.enum(['ringing', 'dialing', 'talking']),
  phone: z.string().nullable(),
  /** ISO time the current state started (talk stopwatch for `talking`). */
  since: z.string(),
});
export type OperatorCall = z.infer<typeof OperatorCallSchema>;

export const OperatorTodaySchema = z.object({
  /** Inbound calls this operator answered. */
  answered: z.number().int(),
  /** Outbound calls placed by this operator that the callee answered. */
  outbound: z.number().int(),
  outboundAttempts: z.number().int(),
  /** Calls whose ring this operator did not take, once per call (missedNoAnswer + missedRejected). */
  missed: z.number().int(),
  /** … the ring ended unanswered. */
  missedNoAnswer: z.number().int(),
  /** … declined after ringing ≥ 1 s. */
  missedRejected: z.number().int(),
  transfersIn: z.number().int(),
  transfersOut: z.number().int(),
  talkSeconds: z.number().int(),
  clientHangups: z.number().int(),
  operatorHangups: z.number().int(),
});
export type OperatorToday = z.infer<typeof OperatorTodaySchema>;

export const LiveOperatorSchema = z.object({
  extension: z.string(),
  name: z.string(),
  presence: OperatorPresenceSchema,
  presenceSince: z.string(),
  /** SIP registration / reachability as reported by Asterisk. */
  registered: z.boolean(),
  ip: z.string().nullable(),
  paused: z.boolean(),
  pauseReason: z.string().nullable(),
  call: OperatorCallSchema.nullable(),
  /** Asterisk queue member counters (raw, since the last `queue reset stats`). */
  queue: z
    .object({
      callsTaken: z.number().int(),
      lastCallAt: z.string().nullable(),
    })
    .nullable(),
  /**
   * Today (Tashkent day): from the CDR for calls that started before `counters.seededThrough`, live (AMI) after it;
   * live only since `counters.since` when there was no CDR seed. Hangup sides are live-only.
   */
  today: OperatorTodaySchema,
  /** The operator photo (Settings → "Operator rasmlari"), versioned URL; null/absent: none, the card shows initials. */
  photoUrl: z.string().nullable().optional(),
});
export type LiveOperator = z.infer<typeof LiveOperatorSchema>;

export const LiveCallSchema = z.object({
  /** Asterisk linkedid. */
  id: CallIdSchema,
  direction: LiveCallDirectionSchema,
  state: LiveCallStateSchema,
  phone: z.string().nullable(),
  callerName: z.string().nullable(),
  queue: z.string().nullable(),
  /** Operator talking (or dialing, for outbound) on this call. */
  extension: z.string().nullable(),
  /** Operators whose phones are ringing for this call. */
  ringing: z.array(z.string()),
  startedAt: z.string(),
  answeredAt: z.string().nullable(),
  /** The current state started at (queue join, ring start, answer). */
  stateSince: z.string(),
});
export type LiveCall = z.infer<typeof LiveCallSchema>;

export const QueueWaitingCallerSchema = z.object({
  callId: CallIdSchema,
  phone: z.string().nullable(),
  position: z.number().int(),
  joinedAt: z.string(),
});
export type QueueWaitingCaller = z.infer<typeof QueueWaitingCallerSchema>;

export const LiveQueueSchema = z.object({
  name: z.string(),
  strategy: z.string().nullable(),
  waiting: z.array(QueueWaitingCallerSchema),
  /** Asterisk's own queue counters (since the last queue stats reset). */
  completed: z.number().int(),
  abandoned: z.number().int(),
  members: z.number().int(),
});
export type LiveQueue = z.infer<typeof LiveQueueSchema>;

/**
 * Today's counters derived from AMI events (Asia/Tashkent day). Definitions (ROADMAP decisions):
 *  inbound          — calls that came in from outside (one per linkedid)
 *  answered         — inbound calls connected to an operator
 *  abandoned        — inbound calls that waited in a queue and ended without an operator
 *  ivrOnly          — inbound calls that ended without reaching a queue or an operator
 *  unanswered       — inbound calls that ended without an operator (abandoned + ivrOnly + other)
 *  answerRate       — answered / inbound, % (B15: inbound only)
 *  outbound         — outbound calls placed; outboundAnswered — of them answered by the callee
 *  operatorMissed   — (call, operator) pairs where the operator's phone rang and they never talked on the call
 *                     = operatorMissedNoAnswer + operatorMissedRejected (offline / busy-at-once phones do not count)
 *  *Hangups         — who ended answered calls (AgentComplete reason / HangupRequest / bridge leave)
 *  avgWaitSec       — average wait of the answered inbound calls: queue entry → first operator answer, 0 for calls
 *                     answered without a queue (= the statistics page's `inbound.avgWaitSec`, METRICS.md §1.4, §2)
 *
 * Calls that started before the API began counting live are seeded from the PBX CDR with the statistics page's
 * definitions (docs/rewrite/METRICS.md): then `seededThrough` is set and `since` is the start of the day. Who hung
 * up is unknown in the CDR, so seeded answered calls count as `unknownHangups`. Without a seed (PBX DB down) the
 * counters cover only calls since `since`.
 */
export const LiveCountersSchema = z.object({
  date: IsoDateSchema,
  /** Calls that started from this moment are counted (start of the day when seeded). */
  since: z.string(),
  /** Calls that started before this moment come from the CDR, later ones from AMI; null = AMI only. */
  seededThrough: z.string().nullable(),
  inbound: z.number().int(),
  answered: z.number().int(),
  abandoned: z.number().int(),
  ivrOnly: z.number().int(),
  unanswered: z.number().int(),
  answerRate: z.number().int(),
  outbound: z.number().int(),
  outboundAnswered: z.number().int(),
  operatorMissed: z.number().int(),
  operatorMissedNoAnswer: z.number().int(),
  operatorMissedRejected: z.number().int(),
  talkSeconds: z.number().int(),
  clientHangups: z.number().int(),
  operatorHangups: z.number().int(),
  unknownHangups: z.number().int(),
  /** Whole seconds; 0 while nothing was answered. */
  avgWaitSec: z.number().int(),
});
export type LiveCounters = z.infer<typeof LiveCountersSchema>;

export const AmiConnectionStateSchema = z.enum(['disabled', 'connecting', 'connected', 'disconnected', 'auth_failed']);
export type AmiConnectionState = z.infer<typeof AmiConnectionStateSchema>;

export const AmiStatusSchema = z.object({
  /** AMI_* is configured. */
  enabled: z.boolean(),
  state: AmiConnectionStateSchema,
  since: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type AmiStatus = z.infer<typeof AmiStatusSchema>;

export const LiveSnapshotSchema = z.object({
  operators: z.array(LiveOperatorSchema),
  calls: z.array(LiveCallSchema),
  queues: z.array(LiveQueueSchema),
  /** null for viewers that may not see KPIs (operators). */
  counters: LiveCountersSchema.nullable(),
  ami: AmiStatusSchema,
  serverTime: z.string(),
});
export type LiveSnapshot = z.infer<typeof LiveSnapshotSchema>;

// ---------------------------------------------------------------------------------------------
// Actions (POST /api/telephony/*). Operators may act only on their own extension / own calls.

/**
 * Free text sent to Asterisk as the QueuePause `Reason` (AMI header, queue_log). Uzbek words need
 * apostrophes ("Yig'ilish", "Ta'til"), typed as ' ` ‘ ’ (ʻ ʼ are letters already). Still no CR/LF
 * (AMI header injection) and no `|` (queue_log field separator).
 */
const PauseReasonSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[\p{L}\p{N} _.,:()'`‘’-]*$/u, "Only letters, digits, spaces and _ . , : ( ) ' -");

export const PauseOperatorRequestSchema = z.object({
  /** Admins: any operator. Operators: omitted or their own extension. */
  extension: ExtensionSchema.optional(),
  paused: z.boolean(),
  reason: PauseReasonSchema.optional(),
});
export type PauseOperatorRequest = z.infer<typeof PauseOperatorRequestSchema>;

export const TransferCallRequestSchema = z.object({
  callId: CallIdSchema,
  /** Target operator extension. */
  target: ExtensionSchema,
});
export type TransferCallRequest = z.infer<typeof TransferCallRequestSchema>;

export const HangupCallRequestSchema = z.object({
  callId: CallIdSchema,
});
export type HangupCallRequest = z.infer<typeof HangupCallRequestSchema>;

export const OriginateCallRequestSchema = z.object({
  /** Number to call; validated server-side against the allowed patterns (no international/premium). */
  to: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^\+?[0-9()\s-]+$/, 'Digits only'),
  /** Admins: operator extension to ring first. Operators: omitted or their own extension. */
  from: ExtensionSchema.optional(),
});
export type OriginateCallRequest = z.infer<typeof OriginateCallRequestSchema>;

export const TelephonyActionResultSchema = z.object({
  ok: z.literal(true),
  message: z.string().optional(),
});
export type TelephonyActionResult = z.infer<typeof TelephonyActionResultSchema>;

// ---------------------------------------------------------------------------------------------

/**
 * Telephony access — API (REST + WS filtering, action rules) and UI both use it. Permission-based
 * (ROLE_PERMISSIONS in permissions.ts):
 *  seeAll    (`monitor.viewAll`) — every citizen number, today's KPI counters, the "who is online" list
 *  manageAll (`actions.call`)    — pause any operator, transfer/hang up any call, click-to-call from any phone
 * Users with neither (operators) see the board with masked numbers and act only on their own extension/calls.
 */
export function telephonyAccess(user: { role: Role; permissions?: readonly Permission[] | null }): {
  seeAll: boolean;
  manageAll: boolean;
} {
  return { seeAll: hasPermission(user, 'monitor.viewAll'), manageAll: hasPermission(user, 'actions.call') };
}

const MASK_CHAR = '•';

/** "901234567" -> "90 ••• •• 67" (keeps the operator code and the last two digits). */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return phone;
  if (phone.length < 5) return MASK_CHAR.repeat(phone.length);
  return `${phone.slice(0, 2)} ${MASK_CHAR.repeat(3)} ${MASK_CHAR.repeat(2)} ${phone.slice(-2)}`;
}

export function isMaskedPhone(phone: string | null | undefined): boolean {
  return Boolean(phone?.includes(MASK_CHAR));
}
