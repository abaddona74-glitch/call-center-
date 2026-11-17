import { CallDirectionFilterSchema, CallScopeSchema, CallStatusFilterSchema, IsoDateSchema } from '@cc/shared';
import { z } from 'zod';
import type { CallHistoryParams } from '@/entities/call';

/** URL search params of /history. Invalid values are dropped instead of failing the route. */
export const historySearchSchema = z.object({
  from: IsoDateSchema.optional().catch(undefined),
  to: IsoDateSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  direction: CallDirectionFilterSchema.optional().catch(undefined),
  status: CallStatusFilterSchema.optional().catch(undefined),
  scope: CallScopeSchema.optional().catch(undefined),
  search: z.string().trim().max(100).optional().catch(undefined),
  /** Phone search over all days (legacy "Barcha kunlar bo'yicha qidirish"). */
  allDays: z.boolean().optional().catch(undefined),
});
export type HistorySearch = z.infer<typeof historySearchSchema>;

export const HISTORY_PAGE_SIZE = 20;

/** URL state → API query (dates default to today in Asia/Tashkent). */
export function historyParams(s: HistorySearch, today: string): CallHistoryParams {
  const allDays = Boolean(s.allDays && s.search);
  return {
    from: allDays ? undefined : (s.from ?? today),
    to: allDays ? undefined : (s.to ?? s.from ?? today),
    page: s.page ?? 1,
    pageSize: HISTORY_PAGE_SIZE,
    direction: s.direction,
    status: s.status,
    scope: s.scope ?? 'all',
    search: s.search || undefined,
  };
}
