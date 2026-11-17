import { type ServerEventName, type ServerEvents, type ClientEventName, type ClientEvents, WS_CLOSE, WS_PATH } from '@cc/shared';
import { useEffect, useRef, useSyncExternalStore } from 'react';

type Handler<K extends ServerEventName> = (data: ServerEvents[K]) => void;
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed';

/**
 * One shared WebSocket for the whole app (endpoint /ws, cookie-authenticated).
 * Reconnects with backoff; stops on 4401/4001 (session gone) and calls onSessionLost.
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<(data: unknown) => void>>();
  private statusListeners = new Set<() => void>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  status: RealtimeStatus = 'idle';
  onSessionLost: (() => void) | null = null;

  connect(): void {
    this.wanted = true;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.setStatus('connecting');
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${window.location.host}${WS_PATH}`);
    this.socket = socket;

    socket.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
    };
    socket.onmessage = (e) => {
      try {
        const frame = JSON.parse(String(e.data)) as { type: string; data: unknown };
        for (const h of this.handlers.get(frame.type) ?? []) h(frame.data);
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onclose = (e) => {
      this.socket = null;
      this.setStatus('closed');
      if (e.code === WS_CLOSE.unauthorized || e.code === WS_CLOSE.sessionTerminated) {
        this.wanted = false;
        this.onSessionLost?.();
        return;
      }
      if (this.wanted) {
        const delay = Math.min(30_000, 500 * 2 ** this.retry++);
        this.timer = setTimeout(() => this.connect(), delay);
      }
    };
  }

  disconnect(): void {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.setStatus('idle');
  }

  on<K extends ServerEventName>(type: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as (data: unknown) => void);
    return () => set.delete(handler as (data: unknown) => void);
  }

  send<K extends ClientEventName>(type: K, data: ClientEvents[K]): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type, data }));
  }

  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  private setStatus(status: RealtimeStatus): void {
    this.status = status;
    for (const l of this.statusListeners) l();
  }
}

export const realtime = new RealtimeClient();

/** Subscribe a component to one server event. The handler can change between renders. */
export function useRealtimeEvent<K extends ServerEventName>(type: K, handler: Handler<K>): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => realtime.on(type, (data) => ref.current(data)), [type]);
}

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(realtime.subscribeStatus, () => realtime.status);
}
