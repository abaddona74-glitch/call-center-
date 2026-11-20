import type { OverviewTicketTotals } from '@cc/shared';

/** Whole percent of `part` in `whole`; 0 when there is nothing to divide by. */
export function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * The period's tickets against the SLA: resolved in time, resolved late, still open after the due date.
 * The rest (still open, deadline not reached) is not a deadline outcome yet.
 */
export function deadlineSplit(t: OverviewTicketTotals): { onTime: number; late: number; stillOverdue: number } {
  return { onTime: Math.max(0, t.done + t.rejected - t.overdueLate), late: t.overdueLate, stillOverdue: t.overdueOpen };
}

/** "DD.MM.YYYY HH:mm" in Asia/Tashkent; "—" without a value. */
export function listDateTime(iso: string | null, toWall: (iso: string) => string): string {
  if (!iso) return '—';
  const w = toWall(iso); // "YYYY-MM-DD HH:mm:ss"
  return `${w.slice(8, 10)}.${w.slice(5, 7)}.${w.slice(0, 4)} ${w.slice(11, 16)}`;
}
