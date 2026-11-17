import type { OnlineUser } from '../presence.js';

export interface PresenceServerEvents {
  /** Full list on every change (only to users who may see it). */
  'presence.online': OnlineUser[];
}
