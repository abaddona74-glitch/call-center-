import { z } from 'zod';
import { CallAnalysisStatsSchema, CallOutcomeSchema, RedFlagCodeSchema, SentimentSchema } from './call-analysis.js';
import { CallScopeSchema } from './cdr.js';
import { IsoDateSchema } from './common.js';
import { DailyPointSchema, HourlyPointSchema, StatsQuerySchema, StatsSummarySchema } from './stats.js';
import { TicketStatusSchema } from './tickets.js';

/**
 * The overview dashboard (permission `overview.view`: observers and the superuser, owner decision 19.11.2026):
 * call-center totals, the regions map, tickets by executives ("Mas'ul shaxslar"), deadlines and calls.
 * Aggregates only — no ticket contents, citizen numbers or call lists. Definitions: docs/rewrite/METRICS.md §9.
 */

/** `region` value for tickets without a region ("Hududsiz"). */
export const OVERVIEW_NO_REGION = 'none';

/** Ticket region codes on the map (`ticket_regions.code`, the 14 seeded regions). */
export const MAP_REGION_CODES = [
  'toshkent-shahri',
  'toshkent-viloyati',
  'andijon',
  'buxoro',
  'fargona',
  'jizzax',
  'xorazm',
  'namangan',
  'navoiy',
  'qashqadaryo',
  'samarqand',
  'sirdaryo',
  'surxondaryo',
  'qoraqalpogiston',
] as const;
export type MapRegionCode = (typeof MAP_REGION_CODES)[number];

const RegionFilterSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'Expected a region code');

export const OverviewTicketsQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    /** A `ticket_regions.code`, or "none" (tickets without a region). Filters everything except `regions`. */
    region: RegionFilterSchema.optional(),
  })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });
export type OverviewTicketsQuery = z.infer<typeof OverviewTicketsQuerySchema>;

const count = z.number().int().nonnegative();
/** Calendar hours, one decimal; null when nothing to average. */
const hours = z.number().nonnegative().nullable();

/**
 * Figures for the tickets CREATED in the period (one cohort, so every share has the same denominator),
 * each in its current state. Same definitions as the ticket reports (TICKETS.md, `buildTicketReport`).
 */
export const OverviewTicketTotalsSchema = z.object({
  /** Created in the period. */
  received: count,
  /** Taken by an executive at least once. */
  taken: count,
  /** Resolution done / rejected (they then wait for the operator's callback or are closed). */
  done: count,
  rejected: count,
  /** Closed: the citizen was called back. */
  closed: count,
  /** Not closed yet. */
  open: count,
  /** Missed the SLA (`due_at`): overdueOpen + overdueLate. */
  overdue: count,
  /** Still with the region (new / assigned / in_progress) after `due_at`. */
  overdueOpen: count,
  /** Done / rejected after `due_at`. */
  overdueLate: count,
  /** Missed the callback SLA (`callback_due_at`): closed late or still waiting after it. */
  callbackOverdue: count,
  /** Created → done / rejected. */
  avgResolutionHours: hours,
  /** Created → closed. */
  avgCloseHours: hours,
});
export type OverviewTicketTotals = z.infer<typeof OverviewTicketTotalsSchema>;

export const OverviewStatusCountSchema = z.object({ status: TicketStatusSchema, count });
export type OverviewStatusCount = z.infer<typeof OverviewStatusCountSchema>;

export const OverviewRegionRowSchema = OverviewTicketTotalsSchema.extend({
  /** null = tickets without a region ("Hududsiz"). */
  regionId: z.number().int().nullable(),
  code: z.string().nullable(),
  nameUz: z.string(),
  nameRu: z.string(),
  /** Active executives assigned to the region. */
  executives: count,
  /** Right now (any creation date): tickets of the region still with it after `due_at`. */
  overdueNow: count,
});
export type OverviewRegionRow = z.infer<typeof OverviewRegionRowSchema>;

export const OverviewExecutiveRowSchema = z.object({
  userId: z.number().int(),
  name: z.string(),
  /** Region codes the executive is assigned to (`ticket_executive_regions`). */
  regions: z.array(z.string()),
  /** Tickets of the period this person took (ticket events), resolved as done / rejected. */
  taken: count,
  done: count,
  rejected: count,
  /** Of the period's tickets this person resolved or holds: missed the SLA. */
  overdue: count,
  /** Created → done / rejected over the tickets this person resolved. */
  avgResolutionHours: hours,
  /** Right now (any creation date): tickets this person holds (assigned / in_progress) and how many are overdue. */
  holdingNow: count,
  overdueNow: count,
});
export type OverviewExecutiveRow = z.infer<typeof OverviewExecutiveRowSchema>;

export const OverviewOverdueTicketSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  regionCode: z.string().nullable(),
  regionNameUz: z.string(),
  regionNameRu: z.string(),
  status: TicketStatusSchema,
  dueAt: z.string(),
  /** Who holds it; null = still in the region queue. */
  executive: z.string().nullable(),
});
export type OverviewOverdueTicket = z.infer<typeof OverviewOverdueTicketSchema>;

/** The state right now, independent of the period (the region filter still applies). */
export const OverviewNowSchema = z.object({
  /** Tickets not closed, by status. */
  byStatus: z.array(OverviewStatusCountSchema),
  /** Still with the region after `due_at`. */
  overdue: count,
  /** Waiting for the operator's callback after `callback_due_at`. */
  callbackOverdue: count,
  /** The most overdue ones (oldest `due_at` first), at most 10. */
  oldestOverdue: z.array(OverviewOverdueTicketSchema),
});
export type OverviewNow = z.infer<typeof OverviewNowSchema>;

export const OverviewTicketsSchema = z.object({
  range: z.object({ from: IsoDateSchema, to: IsoDateSchema }),
  /** The region filter applied (code or "none"), null = whole country. */
  region: z.string().nullable(),
  generatedAt: z.string(),
  /** SLA norms (working days) for the labels. */
  slaWorkingDays: z.number().int().positive(),
  callbackSlaWorkingDays: z.number().int().positive(),
  totals: OverviewTicketTotalsSchema,
  /** The period's tickets by current status. */
  byStatus: z.array(OverviewStatusCountSchema),
  now: OverviewNowSchema,
  /** Every active region (and "Hududsiz" when it has tickets) — never filtered, it feeds the map. */
  regions: z.array(OverviewRegionRowSchema),
  executives: z.array(OverviewExecutiveRowSchema),
});
export type OverviewTickets = z.infer<typeof OverviewTicketsSchema>;

// --- calls ---------------------------------------------------------------------------------

/** Same filter as the statistics page (period + working-time scope). */
export const OverviewCallsQuerySchema = StatsQuerySchema;
export type OverviewCallsQuery = z.infer<typeof OverviewCallsQuerySchema>;

/** The statistics summary and series of the period — the same numbers as /api/stats (METRICS.md §2, §4). */
export const OverviewCallsSchema = z.object({
  summary: StatsSummarySchema,
  hourly: z.array(HourlyPointSchema),
  daily: z.array(DailyPointSchema),
});
export type OverviewCalls = z.infer<typeof OverviewCallsSchema>;

// --- call quality (AI analysis) ------------------------------------------------------------

/** Calls have no region: the page's region filter does not apply here. */
export const OverviewQualityQuerySchema = z
  .object({ from: IsoDateSchema, to: IsoDateSchema })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });
export type OverviewQualityQuery = z.infer<typeof OverviewQualityQuerySchema>;

const statsShape = CallAnalysisStatsSchema.shape;

/**
 * AI call-quality aggregates of the period — the «Tahlil» page's numbers for the CURRENT prompt version only
 * (scores of different versions are never mixed; METRICS.md §8). Aggregates only: no transcripts, no texts, no numbers.
 */
export const OverviewQualitySchema = z.object({
  range: z.object({ from: IsoDateSchema, to: IsoDateSchema }),
  promptVersion: z.string(),
  /** Analysed calls of this prompt version (0 while the analysis is off). */
  analyzed: count,
  /** Answered inbound + connected outbound calls of the period, any hour; null when the PBX is unavailable. */
  answeredCalls: count.nullable(),
  /** analyzed / answeredCalls, percent with one decimal; null without answered calls or PBX. */
  analyzedShare: z.number().nonnegative().nullable(),
  /** Average overall score, 1–10; null without analysed calls. */
  avgOverall: z.number().nullable(),
  avgScores: statsShape.totals.shape.avgScores,
  /** Calls with at least one red flag. */
  redFlagCalls: count,
  redFlags: statsShape.redFlags,
  outcomes: statsShape.outcomes,
  /** Handled in the call (resolved + info_only + ticket_opened), percent of analysed; null without calls. */
  handledRate: z.number().nullable(),
  /** Client sentiment at the end of the call. */
  sentimentEnd: statsShape.sentiment.shape.end,
});
export type OverviewQuality = z.infer<typeof OverviewQualitySchema>;

// --- details: the records behind each number (owner, 19.11.2026) ---------------------------------------------
// Every number on the page opens the list it is made of; the list total equals the number for the same filters.

const pageParams = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
};

/**
 * Ticket numbers of the page (METRICS.md §9.1):
 *  - the period (tickets created in it): received … callbackOverdue = the totals' fields; `resolved` / `closeTimed` =
 *    the tickets the average resolution / close time is over; `onTime` = resolved by the due date;
 *  - now (not closed, any creation date): `nowOpen`, `nowStatus` (+ `status`), `nowOverdue`, `nowCallbackOverdue`;
 *  - one Mas'ul (+ `executive`): `exTaken`, `exDone`, `exRejected`, `exOverdue`, `exResolved` (the period),
 *    `exHolding`, `exOverdueNow` (now).
 * The region filter applies to all of them.
 */
export const OVERVIEW_TICKET_METRICS = [
  'received',
  'taken',
  'done',
  'rejected',
  'closed',
  'open',
  'overdue',
  'overdueOpen',
  'overdueLate',
  'callbackOverdue',
  'resolved',
  'closeTimed',
  'onTime',
  'nowOpen',
  'nowStatus',
  'nowOverdue',
  'nowCallbackOverdue',
  'exTaken',
  'exDone',
  'exRejected',
  'exOverdue',
  'exResolved',
  'exHolding',
  'exOverdueNow',
] as const;
export const OverviewTicketMetricSchema = z.enum(OVERVIEW_TICKET_METRICS);
export type OverviewTicketMetric = z.infer<typeof OverviewTicketMetricSchema>;

export const OverviewTicketListQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    region: RegionFilterSchema.optional(),
    metric: OverviewTicketMetricSchema,
    /** `nowStatus` only. */
    status: TicketStatusSchema.optional(),
    /** `ex*` metrics only: the Mas'ul's user id. */
    executive: z.coerce
      .number()
      .int()
      .positive()
      .max(2 ** 31)
      .optional(),
    ...pageParams,
  })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] })
  .refine((q) => q.metric !== 'nowStatus' || q.status !== undefined, {
    message: '`status` is required',
    path: ['status'],
  })
  .refine((q) => !q.metric.startsWith('ex') || q.executive !== undefined, {
    message: '`executive` is required',
    path: ['executive'],
  });
export type OverviewTicketListQuery = z.infer<typeof OverviewTicketListQuerySchema>;

export const OverviewTicketListItemSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  createdAt: z.string(),
  regionCode: z.string().nullable(),
  regionNameUz: z.string(),
  regionNameRu: z.string(),
  /** Who resolved it, else who holds it; null = still in the region queue. */
  executive: z.string().nullable(),
  status: TicketStatusSchema,
  dueAt: z.string().nullable(),
  /** Hours past the due date: resolved late (at resolution) or still with the region (now); null when in time. */
  overdueHours: z.number().nonnegative().nullable(),
  closedAt: z.string().nullable(),
  organization: z.string().nullable(),
});
export type OverviewTicketListItem = z.infer<typeof OverviewTicketListItemSchema>;

export const OverviewTicketListSchema = z.object({
  items: z.array(OverviewTicketListItemSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type OverviewTicketList = z.infer<typeof OverviewTicketListSchema>;

/**
 * Call numbers (METRICS.md §2, the summary): `total` = inbound + connected outbound ("Jami"), `inbound`, `outbound`
 * (connected), `answered`, `unanswered` (= abandoned + ivr + afterHours), `abandoned`, `ivr`, `afterHours`; `talked`
 * = answered inbound + connected outbound (the average talk time is over them). The average wait is over `answered`.
 */
export const OVERVIEW_CALL_METRICS = [
  'total',
  'inbound',
  'outbound',
  'answered',
  'unanswered',
  'abandoned',
  'ivr',
  'afterHours',
  'talked',
] as const;
export const OverviewCallMetricSchema = z.enum(OVERVIEW_CALL_METRICS);
export type OverviewCallMetric = z.infer<typeof OverviewCallMetricSchema>;

export const OverviewCallListQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    scope: CallScopeSchema.default('working'),
    metric: OverviewCallMetricSchema,
    ...pageParams,
  })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });
export type OverviewCallListQuery = z.infer<typeof OverviewCallListQuerySchema>;

/**
 * Call-quality numbers (METRICS.md §9.3): the analysed calls (current prompt version) behind them — `analyzed` (also
 * the average score), `handled`, `flagged`, one red `flag`, one `outcome`, one end `sentiment`.
 */
export const OVERVIEW_QUALITY_METRICS = ['analyzed', 'handled', 'flagged', 'flag', 'outcome', 'sentiment'] as const;
export const OverviewQualityMetricSchema = z.enum(OVERVIEW_QUALITY_METRICS);
export type OverviewQualityMetric = z.infer<typeof OverviewQualityMetricSchema>;

export const OverviewQualityListQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    metric: OverviewQualityMetricSchema,
    flag: RedFlagCodeSchema.optional(),
    outcome: CallOutcomeSchema.optional(),
    sentiment: SentimentSchema.optional(),
    ...pageParams,
  })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] })
  .refine((q) => q.metric !== 'flag' || q.flag !== undefined, { message: '`flag` is required', path: ['flag'] })
  .refine((q) => q.metric !== 'outcome' || q.outcome !== undefined, {
    message: '`outcome` is required',
    path: ['outcome'],
  })
  .refine((q) => q.metric !== 'sentiment' || q.sentiment !== undefined, {
    message: '`sentiment` is required',
    path: ['sentiment'],
  });
export type OverviewQualityListQuery = z.infer<typeof OverviewQualityListQuerySchema>;
