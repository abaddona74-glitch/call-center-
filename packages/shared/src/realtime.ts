/**
 * WebSocket protocol (endpoint: /ws, JSON text frames).
 *
 * Every frame is `{ "type": <event name>, "data": <payload> }`.
 * Naming: "<domain>.<event>" in lower camel case, e.g. "calls.hangup".
 *
 * Adding events for a domain: create `src/realtime/<domain>.ts` exporting
 * `interface <Domain>ServerEvents { ... }` (and client events if any), then add it
 * to the `extends` list of `ServerEvents` / `ClientEvents` below — one line per domain.
 */

import type { RecordingsServerEvents } from './realtime/recordings.js';
import type { TicketsServerEvents } from './realtime/tickets.js';
import type { CallbacksServerEvents } from './realtime/callbacks.js';

interface CoreServerEvents {
  /** Sent once right after the connection is authenticated. */
  'session.ready': { userId: number; role: string; serverTime: string };
  /** The session was revoked (logout elsewhere, password change). Client must go to /login. */
  'session.terminated': { reason: string };
}

interface CoreClientEvents {
  /** Keep-alive / presence. */
  'presence.ping': { tab?: string; visible?: boolean };
}

export interface ServerEvents
  extends CoreServerEvents,
    RecordingsServerEvents,
    TicketsServerEvents,
    CallbacksServerEvents {}

export interface ClientEvents extends CoreClientEvents {}

export type ServerEventName = keyof ServerEvents;
export type ClientEventName = keyof ClientEvents;

export type ServerFrame<K extends ServerEventName = ServerEventName> = {
  type: K;
  data: ServerEvents[K];
};
export type ClientFrame<K extends ClientEventName = ClientEventName> = {
  type: K;
  data: ClientEvents[K];
};

export const WS_PATH = '/ws';
/** Close codes used by the server. */
export const WS_CLOSE = {
  unauthorized: 4401,
  forbidden: 4403,
  sessionTerminated: 4001,
} as const;
