import { z } from 'zod';

/** Error body returned by every failing API call (see apps/api HttpExceptionFilter). */
export const ApiErrorSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  issues: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}
export type Paginated<T> = { items: T[]; page: number; pageSize: number; total: number };

/** Calendar date in Asia/Tashkent, ISO format YYYY-MM-DD. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const DateRangeQuerySchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
});
export type DateRangeQuery = z.infer<typeof DateRangeQuerySchema>;

/** Business timezone for every date calculation (working hours, daily stats, reports). */
export const BUSINESS_TIMEZONE = 'Asia/Tashkent';
