import type { Callback } from '../callbacks.js';

/**
 * Server → client events of the callbacks / contacts / blacklist slice (session S4).
 * Contacts and blacklist events carry no data: clients refetch over REST, where permissions
 * are checked (contacts are hidden from some operator groups).
 */
export interface CallbacksServerEvents {
  /** Callbacks created or changed (missed call, attempt, resolution, manual action). Sent to every role. */
  'callbacks.updated': { items: Callback[] };
  /** The phonebook changed; refetch `/api/contacts`. */
  'contacts.changed': { at: string };
  /** Admin only. */
  'blacklist.changed': { at: string };
}
