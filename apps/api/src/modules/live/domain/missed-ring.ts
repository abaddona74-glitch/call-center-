import type { MissReason } from '@cc/shared';
import { REJECT_MIN_RING_SEC } from '../../../pbx/calls/dialplan.js';

/**
 * How one AMI dial towards an operator ended, by the same rule as the CDR (`missReasonOfRow`), so a call gives the
 * same misses live and from the CDR seed:
 *  - NOANSWER, CANCEL → no_answer (Asterisk writes both dial statuses as CDR `NO ANSWER`: ring timeout, the caller left,
 *    the queue moved on);
 *  - BUSY after ringing ≥ 1 000 ms → rejected (the CDR's `duration >= 1` is the same: whole seconds rounded down);
 *  - CHANUNAVAIL / CONGESTION (phone offline), BUSY at once (already on a call), ANSWER → null.
 */
export function missReasonOfDial(status: string, ringMs: number): MissReason | null {
  const s = status.toUpperCase();
  if (s === 'NOANSWER' || s === 'CANCEL') return 'no_answer';
  if (s === 'BUSY' && ringMs >= REJECT_MIN_RING_SEC * 1000) return 'rejected';
  return null;
}
