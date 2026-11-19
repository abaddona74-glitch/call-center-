import type { OverviewTicketTotals } from '@cc/shared';

/** Whole percent of `part` in `whole`; 0 when there is nothing to divide by. */
export function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** How long a deadline has passed: whole days from one day on, else whole hours (at least 1). */
export function lateBy(dueAt: string, now: Date): { unit: 'days' | 'hours'; n: number } {
  const hours = Math.max(0, (now.getTime() - new Date(dueAt).getTime()) / 3_600_000);
  return hours >= 24
    ? { unit: 'days', n: Math.floor(hours / 24) }
    : { unit: 'hours', n: Math.max(1, Math.floor(hours)) };
}

/**
 * The period's tickets against the SLA: resolved in time, resolved late, still open after the due date.
 * The rest (still open, deadline not reached) is not a deadline outcome yet.
 */
export function deadlineSplit(t: OverviewTicketTotals): { onTime: number; late: number; stillOverdue: number } {
  return { onTime: Math.max(0, t.done + t.rejected - t.overdueLate), late: t.overdueLate, stillOverdue: t.overdueOpen };
}
