import type { ExpressionBuilder } from 'kysely';
import type { PbxDB } from '../pbx-db.types.js';

/**
 * SQL twin of `isQueueMemberRingAttempt` (modules/callbacks/domain/cdr-calls.ts): keeps every row except a queue
 * member's own ring attempt that never reached a phone (`Local/…` in `from-internal` with no peer channel; about half
 * of all CDR rows in production). Use it only when the CDR has no `linkedid` (PBX_CDR_HAS_LINKEDID=false): keyed by
 * uniqueid such a row is a group of its own that never forms a call, so leaving it out changes no result. With linkedid
 * the member legs belong to the caller's call and must stay.
 */
export function notQueueMemberRingAttempt(eb: ExpressionBuilder<PbxDB, 'cdr'>) {
  return eb.not(
    eb.and([eb('channel', 'like', 'Local/%'), eb('dcontext', '=', 'from-internal'), eb('dstchannel', '=', '')]),
  );
}
