import { z } from 'zod';
import { CallScopeSchema } from './cdr.js';
import { IsoDateSchema } from './common.js';

/**
 * Historical statistics computed from the PBX CDR. Every number has exactly one definition,
 * documented in docs/rewrite/METRICS.md and implemented once in apps/api/src/modules/stats/domain.
 */

export const StatsQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    /** Default "working": only calls that started inside the working calendar. */
    scope: CallScopeSchema.default('working'),
  })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });
export type StatsQuery = z.infer<typeof StatsQuerySchema>;

const RangeSchema = z.object({ from: IsoDateSchema, to: IsoDateSchema, scope: CallScopeSchema });

const int = z.number().int();
/** Percent 0–100, one decimal. */
const rate = z.number();

export const StatsSummarySchema = z.object({
  range: RangeSchema,
  /** "Jami": inbound offered + outbound connected. */
  totalCalls: int,
  inbound: z.object({
    offered: int,
    answered: int,
    abandoned: int,
    ivr: int,
    afterHours: int,
    answerRate: rate,
    abandonRate: rate,
    avgWaitSec: int,
    maxWaitSec: int,
    avgAbandonWaitSec: int,
    clients: int,
    answeredClients: int,
    /** Distinct numbers with an abandoned/IVR call and no answered call or connected callback later in the range. */
    lostClients: int,
    hiddenNumbers: int,
  }),
  outbound: z.object({
    attempts: int,
    connected: int,
    notConnected: int,
    connectRate: rate,
    clients: int,
  }),
  internal: z.object({ calls: int }),
  transfers: int,
  talk: z.object({ totalSec: int, avgSec: int }),
  /** Distinct client numbers over inbound + outbound. */
  clients: int,
});
export type StatsSummary = z.infer<typeof StatsSummarySchema>;

export const OperatorStatsRowSchema = z.object({
  ext: z.string(),
  name: z.string().nullable(),
  group: z.string().nullable(),
  /** Inbound calls answered from the queue and finished by this operator (not transferred away). */
  answered: int,
  /** Transfer chains this operator finished (received a transfer and was the last to talk). */
  transferredIn: int,
  /** Transfers this operator made. */
  transferredOut: int,
  /** Outbound calls that connected. */
  outbound: int,
  outboundAttempts: int,
  /** Inbound calls where this operator's phone rang but they did not answer. */
  missed: int,
  /** "Jami" per operator: answered + transferredIn + outbound. Sums to the center's answered inbound + connected outbound. */
  total: int,
  talkSec: int,
  /** talkSec / number of calls the operator talked on. */
  avgTalkSec: int,
  /** Post-call survey: ratings (1–5) clients gave this operator for in-scope calls of the range. */
  surveyCount: int,
  /** Average rating, two decimals; null without ratings. */
  surveyAvg: z.number().min(1).max(5).nullable(),
});
export type OperatorStatsRow = z.infer<typeof OperatorStatsRowSchema>;

export const OperatorStatsQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    scope: CallScopeSchema.default('working'),
    group: z.string().trim().max(32).optional(),
  })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });
export type OperatorStatsQuery = z.infer<typeof OperatorStatsQuerySchema>;

export const OperatorStatsResponseSchema = z.object({
  range: RangeSchema,
  operators: z.array(OperatorStatsRowSchema),
  groups: z.array(z.object({ id: z.string(), from: int, to: int })),
  /** false while the PBX survey table is missing or not granted to the read-only user (UI hides the column). */
  surveyAvailable: z.boolean(),
});
export type OperatorStatsResponse = z.infer<typeof OperatorStatsResponseSchema>;

export const HourlyPointSchema = z.object({
  hour: int,
  inbound: int,
  answered: int,
  abandoned: int,
  outbound: int,
});
export type HourlyPoint = z.infer<typeof HourlyPointSchema>;

export const DailyPointSchema = z.object({
  date: IsoDateSchema,
  inbound: int,
  answered: int,
  abandoned: int,
  outbound: int,
  talkSec: int,
  workingDay: z.boolean(),
});
export type DailyPoint = z.infer<typeof DailyPointSchema>;

export const StatsSeriesResponseSchema = z.object({
  range: RangeSchema,
  hourly: z.array(HourlyPointSchema),
  daily: z.array(DailyPointSchema),
});
export type StatsSeriesResponse = z.infer<typeof StatsSeriesResponseSchema>;

export const TopClientsQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    scope: CallScopeSchema.default('working'),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });
export type TopClientsQuery = z.infer<typeof TopClientsQuerySchema>;

export const TopClientRowSchema = z.object({
  number: z.string(),
  inbound: int,
  answered: int,
  missed: int,
  outbound: int,
  talkSec: int,
  lastCallAt: z.string(),
});
export type TopClientRow = z.infer<typeof TopClientRowSchema>;

export const TopClientsResponseSchema = z.object({
  range: RangeSchema,
  clients: z.array(TopClientRowSchema),
});
export type TopClientsResponse = z.infer<typeof TopClientsResponseSchema>;

// --- Excel export ---

export const EXPORT_LANGUAGES = ['uz', 'ru'] as const;

export const ExportExcelQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    /** Operator group id from OPERATOR_GROUPS ("main", "secondary"), or "all". */
    group: z.string().trim().max(32).default('all'),
    lang: z.enum(EXPORT_LANGUAGES).default('uz'),
    scope: CallScopeSchema.default('working'),
  })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });
export type ExportExcelQuery = z.infer<typeof ExportExcelQuerySchema>;
