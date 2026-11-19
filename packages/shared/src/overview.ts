import { z } from 'zod';
import { IsoDateSchema } from './common.js';
import { DailyPointSchema, HourlyPointSchema, StatsQuerySchema, StatsSummarySchema } from './stats.js';
import { TicketStatusSchema } from './tickets.js';

/**
 * The overview dashboard (permission `overview.view`: observers and the superuser, owner decision 19.11.2026):
 * call-center totals, the regions map, tickets by executives ("Mas'ul shaxslar"), deadlines and calls.
 * Aggregates only — no ticket contents, citizen numbers or call lists. Definitions: docs/rewrite/METRICS.md §8.
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
