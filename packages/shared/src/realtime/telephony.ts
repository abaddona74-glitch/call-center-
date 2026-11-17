import type { AmiStatus, LiveCall, LiveCounters, LiveOperator, LiveQueue } from '../telephony.js';

/**
 * Live telephony push events. Each carries the full current list (idempotent, the client replaces
 * its cache). Initial state: GET /api/live/snapshot. Payloads are already filtered for the
 * receiving user's role (operators get masked numbers and no counters).
 */
export interface TelephonyServerEvents {
  'telephony.operators': LiveOperator[];
  'telephony.calls': LiveCall[];
  'telephony.queues': LiveQueue[];
  /** Admins only. */
  'telephony.counters': LiveCounters;
  'telephony.ami': AmiStatus;
}
