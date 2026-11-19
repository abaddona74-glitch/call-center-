import { z } from 'zod';
import { CallScopeSchema } from './cdr.js';
import { IsoDateSchema } from './common.js';
import { OperatorStatsRowSchema } from './stats.js';

/**
 * The staff KPI page «KPI xodimlar» (permission `kpi.view`: observers and the superuser, owner decision 19.11.2026).
 * Two views of one period: operators (calls, client ratings, tickets and callbacks, AI call quality, online/pause
 * time) and the "Mas'ul shaxslar" (executives: ticket processing, also per region). No composite score: the owner
 * picks weights later. Figures only — no ticket texts, citizen numbers or call lists.
 * Definitions: docs/rewrite/METRICS.md §10.
 */

const range = { from: IsoDateSchema, to: IsoDateSchema };
const fromNotAfterTo = (q: { from: string; to: string }) => q.from <= q.to;
const fromNotAfterToError = { message: '`from` must not be after `to`', path: ['from'] };

export const KpiOperatorsQuerySchema = z
  .object({
    ...range,
    /** Calls and online time: working time only (default, like «Statistika») or all hours. */
    scope: CallScopeSchema.default('working'),
  })
  .refine(fromNotAfterTo, fromNotAfterToError);
export type KpiOperatorsQuery = z.infer<typeof KpiOperatorsQuerySchema>;

export const KpiExecutivesQuerySchema = z.object(range).refine(fromNotAfterTo, fromNotAfterToError);
export type KpiExecutivesQuery = z.infer<typeof KpiExecutivesQuerySchema>;

const count = z.number().int().nonnegative();
/** Percent, one decimal; null when there is nothing to divide by. */
const percent = z.number().min(0).max(100).nullable();
/** Calendar hours, one decimal; null when nothing to average. */
const hours = z.number().nonnegative().nullable();
/** Average of 1–5 / 1–10 scores, two decimals; null without scores. */
const average = z.number().nonnegative().nullable();

// --- Operators ---------------------------------------------------------------------------------

/** Calls: the same fields and function as GET /api/stats/operators (`operatorStats`), so the numbers are equal. */
export const KpiOperatorCallsSchema = OperatorStatsRowSchema.omit({
  ext: true,
  name: true,
  group: true,
  surveyCount: true,
  surveyAvg: true,
});
export type KpiOperatorCalls = z.infer<typeof KpiOperatorCallsSchema>;

/** Post-call survey (1–5), same rule as «Statistika» (`surveyByOperator`). */
export const KpiOperatorSurveySchema = z.object({ count, avg: average });

/** Tickets the operator opened and the callbacks on done/rejected tickets (by the operator's extension). */
export const KpiOperatorTicketsSchema = z.object({
  /** Tickets this operator opened in the period. */
  created: count,
  /** Callback calls this operator made to citizens on done/rejected tickets in the period (every attempt). */
  callbacks: count,
  /** Tickets this operator closed in the period after a confirmed callback (not superuser force-closes). */
  closed: count,
  /** Of `closed`: closed after the callback deadline (`callback_due_at`). */
  closedLate: count,
});
export type KpiOperatorTickets = z.infer<typeof KpiOperatorTicketsSchema>;

/** AI call quality over this operator's analysed calls of the CURRENT prompt version (= «Tahlil» page). */
export const KpiOperatorQualitySchema = z.object({
  analysed: count,
  /** 1–10. */
  avgOverall: average,
  /** 1–5 per criterion (KPI_CRITERIA; the greeting is not scored since v4). */
  avgScores: z.object({ politeness: average, understanding: average, solution: average, closing: average }),
  /** Analysed calls with at least one red flag. */
  redFlagCalls: count,
  /** (resolved + info_only + ticket_opened) / analysed × 100. */
  handledRate: percent,
});
export type KpiOperatorQuality = z.infer<typeof KpiOperatorQualitySchema>;

export const KpiPauseReasonSchema = z.object({
  /** As the operator typed it when pausing; null = no reason given. */
  reason: z.string().nullable(),
  sec: count,
});
export type KpiPauseReason = z.infer<typeof KpiPauseReasonSchema>;

/** From the presence log (`operator_presence_log`), clipped to the period (and working time for scope=working). */
export const KpiOperatorPresenceSchema = z.object({
  /** Phone registered (SIP), pauses included. */
  onlineSec: count,
  /** Paused in the queue while online. */
  pauseSec: count,
  /** Pause time by reason, longest first. */
  pauses: z.array(KpiPauseReasonSchema),
  /** Talk time (calls.talkSec) / online time × 100, capped at 100; null without online time or call data. */
  talkShare: percent,
});
export type KpiOperatorPresence = z.infer<typeof KpiOperatorPresenceSchema>;

export const KpiOperatorRowSchema = z.object({
  ext: z.string(),
  name: z.string().nullable(),
  group: z.string().nullable(),
  /** null while the PBX database is unavailable. */
  calls: KpiOperatorCallsSchema.nullable(),
  survey: KpiOperatorSurveySchema,
  tickets: KpiOperatorTicketsSchema,
  /** null = no analysed calls of the current prompt version in the period. */
  quality: KpiOperatorQualitySchema.nullable(),
  presence: KpiOperatorPresenceSchema,
});
export type KpiOperatorRow = z.infer<typeof KpiOperatorRowSchema>;

export const KpiOperatorsResponseSchema = z.object({
  range: z.object({ ...range, scope: CallScopeSchema }),
  generatedAt: z.string(),
  /** false: the PBX database is unavailable — no call figures, names or ratings (tickets and the rest still work). */
  callsAvailable: z.boolean(),
  /** The PBX has the post-call survey table (`operator_baho`). */
  surveyAvailable: z.boolean(),
  quality: z.object({
    promptVersion: z.string(),
    /** Analysed calls of the period (current prompt version), all operators. */
    analysed: count,
    /** Answered inbound + connected outbound calls of the period, all hours; null without the PBX. */
    answeredCalls: count.nullable(),
    /** Days (YYYY-MM-DD, Asia/Tashkent) that have analysed calls: the analysis does not cover every day yet. */
    days: z.array(IsoDateSchema),
  }),
  presence: z.object({
    /** When the presence log started (first record ever, ISO); null = nothing recorded yet. */
    since: z.string().nullable(),
    /** The period starts before the log: its online/pause time is incomplete. */
    partial: z.boolean(),
  }),
  operators: z.array(KpiOperatorRowSchema),
});
export type KpiOperatorsResponse = z.infer<typeof KpiOperatorsResponseSchema>;

// --- Executives ("Mas'ul shaxslar") --------------------------------------------------------------

/**
 * One executive's ticket processing (whole or in one region), attributed by the ticket events (who took / resolved /
 * released / forwarded, and the ticket's region at that moment). Period figures count events in the period;
 * `holdingNow` / `overdueNow` are the state right now.
 */
export const KpiExecutiveFiguresSchema = z.object({
  /** Tickets that entered the queue of the person's assigned region(s) in the period (created there or forwarded
   * in); the same for every executive of a region. null for a region the person is not assigned to. */
  arrived: count.nullable(),
  /** Tickets the person took in the period (distinct tickets). */
  taken: count,
  /** Resolved by the person in the period. */
  done: count,
  rejected: count,
  /** Given back to the region queue by the person in the period. */
  released: count,
  /** Sent to another region by the person in the period. */
  forwarded: count,
  /** Of done + rejected: resolved after the ticket's deadline (`due_at`). */
  late: count,
  /** (done + rejected − late) / (done + rejected) × 100. */
  onTimeRate: percent,
  /** Ticket entered the region queue (created, forwarded in or released) → taken by the person, calendar hours. */
  avgTakeHours: hours,
  /** Taken by the person → done / rejected by the person, calendar hours. */
  avgResolveHours: hours,
  /** Right now: tickets the person holds (assigned / in progress) and how many of them are past `due_at`. */
  holdingNow: count,
  overdueNow: count,
});
export type KpiExecutiveFigures = z.infer<typeof KpiExecutiveFiguresSchema>;

export const KpiExecutiveRegionSchema = KpiExecutiveFiguresSchema.extend({
  /** null = tickets without a region ("Hududsiz"). */
  regionId: z.number().int().nullable(),
  code: z.string().nullable(),
  nameUz: z.string(),
  nameRu: z.string(),
  /** The person is assigned to this region now (`ticket_executive_regions`). */
  assigned: z.boolean(),
});
export type KpiExecutiveRegion = z.infer<typeof KpiExecutiveRegionSchema>;

export const KpiExecutiveRowSchema = z.object({
  userId: z.number().int(),
  name: z.string(),
  totals: KpiExecutiveFiguresSchema,
  /** Assigned regions first (directory order), then other regions the person acted in. */
  regions: z.array(KpiExecutiveRegionSchema),
});
export type KpiExecutiveRow = z.infer<typeof KpiExecutiveRowSchema>;

export const KpiExecutivesResponseSchema = z.object({
  range: z.object(range),
  generatedAt: z.string(),
  slaWorkingDays: z.number().int().positive(),
  executives: z.array(KpiExecutiveRowSchema),
});
export type KpiExecutivesResponse = z.infer<typeof KpiExecutivesResponseSchema>;
