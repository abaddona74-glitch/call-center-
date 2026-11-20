import type { KpiOperatorCallMetric } from '@cc/shared';

/**
 * The tabs of a call list opened from an operator's number: the missed calls split into "not answered" / "rejected",
 * the outbound calls into connected / all attempts; every other number shows its one list.
 */
export function callTabsOf(metric: KpiOperatorCallMetric): KpiOperatorCallMetric[] {
  if (metric === 'missed') return ['missed', 'missedNoAnswer', 'missedRejected'];
  if (metric === 'outbound') return ['outbound', 'outboundAttempts'];
  return [metric];
}

/** A stable id per number, so a dialog starts over (first tab, page 1, no search) when another number opens. */
export function detailId(params: object): string {
  return JSON.stringify(params);
}
