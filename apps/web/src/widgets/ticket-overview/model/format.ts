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

/** "DD.MM.YYYY HH:mm" in Asia/Tashkent; "—" without a value. */
export function listDateTime(iso: string | null, toWall: (iso: string) => string): string {
  if (!iso) return '—';
  const w = toWall(iso); // "YYYY-MM-DD HH:mm:ss"
  return `${w.slice(8, 10)}.${w.slice(5, 7)}.${w.slice(0, 4)} ${w.slice(11, 16)}`;
}

/** How late, from hours past the due date: whole days from one day on, else whole hours (at least 1). */
export function overdueParts(hours: number | null): { unit: 'days' | 'hours'; n: number } | null {
  if (hours === null) return null;
  return hours >= 24
    ? { unit: 'days', n: Math.floor(hours / 24) }
    : { unit: 'hours', n: Math.max(1, Math.floor(hours)) };
}
