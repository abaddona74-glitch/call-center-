import { type WorkingCalendarInput, WorkingCalendarSchema } from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

export const workingCalendarKeys = {
  all: ['working-calendar'] as const,
};

/** The one working calendar (stats "working hours", callbacks "after hours", ticket deadlines). */
export const workingCalendarQuery = queryOptions({
  queryKey: workingCalendarKeys.all,
  queryFn: ({ signal }) => api('/working-calendar', { schema: WorkingCalendarSchema, signal }),
  staleTime: 5 * 60_000,
});

export function saveWorkingCalendar(body: WorkingCalendarInput) {
  return api('/working-calendar', { method: 'PUT', body, schema: WorkingCalendarSchema });
}
