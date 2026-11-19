import { IsoDateSchema, TopicKeySchema } from '@cc/shared';
import { z } from 'zod';
import { shiftDate } from '@/entities/call';
import type { CallAnalysisStatsParams } from '@/entities/call-analysis';

/** URL search params of /analysis. Invalid values are dropped. */
export const analysisSearchSchema = z.object({
  from: IsoDateSchema.optional().catch(undefined),
  to: IsoDateSchema.optional().catch(undefined),
  operator: z
    .string()
    .regex(/^[0-9]{2,6}$/)
    .optional()
    .catch(undefined),
  /** A topic key (`stats.topics[].key`): narrows the problems list. */
  topic: TopicKeySchema.optional().catch(undefined),
  /** Prompt version the figures are made of; empty = the current one. */
  version: z.string().trim().min(1).max(40).optional().catch(undefined),
});
export type AnalysisSearch = z.infer<typeof analysisSearchSchema>;

/** Days in the default period (the last week, today included). */
export const DEFAULT_DAYS = 7;

/** URL state → stats query: default the last 7 days, never past today, `from` ≤ `to`. */
export function analysisQueryFrom(s: AnalysisSearch, today: string): CallAnalysisStatsParams {
  const to = s.to && s.to <= today ? s.to : today;
  const from = s.from && s.from <= to ? s.from : shiftDate(to, -(DEFAULT_DAYS - 1));
  const q: CallAnalysisStatsParams = { from, to };
  if (s.operator) q.operator = s.operator;
  if (s.topic) q.topic = s.topic;
  if (s.version) q.promptVersion = s.version;
  return q;
}
