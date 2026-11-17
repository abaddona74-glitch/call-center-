import { EventEmitter } from 'node:events';
import { Socket, createConnection } from 'node:net';
import type { AmiConnectionState } from '@cc/shared';
import { type AmiFieldValue, type AmiMessage, AmiParser, serializeAction } from './ami.protocol.js';

export interface AmiClientOptions {
  host: string;
  port: number;
  username: string;
  secret: string;
  /** Keepalive Ping period. A Ping without an answer drops the connection. */
  pingIntervalMs?: number;
  connectTimeoutMs?: number;
  actionTimeoutMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  /** After "Authentication failed" — don't hammer the PBX (account lockouts, log noise). */
  authFailedRetryMs?: number;
  log?: (level: 'debug' | 'log' | 'warn' | 'error', message: string) => void;
}

export interface AmiResponse {
  /** Response headers (`response`, `message`, ...). */
  fields: AmiMessage;
  /** Events of a list action (CoreShowChannels, QueueStatus, ...), without the closing *Complete event. */
  events: AmiMessage[];
}

export class AmiError extends Error {
  constructor(
    message: string,
    readonly kind: 'disconnected' | 'timeout' | 'rejected',
    readonly response?: AmiMessage,
  ) {
    super(message);
    this.name = 'AmiError';
  }
}

export interface ActionOptions {
  /** Collect events with the same ActionID until `until` matches (default: `EventList: Complete`). */
  list?: boolean;
  until?: (evt: AmiMessage) => boolean;
  timeoutMs?: number;
}

interface Pending {
  action: string;
  opts: ActionOptions;
  response: AmiMessage | null;
  events: AmiMessage[];
  resolve: (r: AmiResponse) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

type ClientEvents = {
  event: [AmiMessage];
  state: [AmiConnectionState, string | null];
};

const isListComplete = (evt: AmiMessage) => evt.eventlist?.toLowerCase() === 'complete';

/**
 * Minimal typed AMI client (no third-party library): login, ActionID correlation, list actions,
 * event stream, Ping keepalive, reconnect with exponential backoff + jitter.
 *
 * Unsolicited events are emitted as `event`; events that belong to a pending list action are
 * returned in that action's result instead (so a poll is not processed twice).
 */
export class AmiClient extends EventEmitter<ClientEvents> {
  private socket: Socket | null = null;
  private parser = new AmiParser();
  private pending = new Map<string, Pending>();
  private seq = 0;
  private running = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private loginId: string | null = null;
  private _state: AmiConnectionState = 'disconnected';
  private _lastError: string | null = null;
  private _since: Date | null = null;

  private readonly o: Required<Omit<AmiClientOptions, 'log'>> & Pick<AmiClientOptions, 'log'>;

  constructor(options: AmiClientOptions) {
    super();
    this.o = {
      pingIntervalMs: 20_000,
      connectTimeoutMs: 5_000,
      actionTimeoutMs: 10_000,
      reconnectMinMs: 1_000,
      reconnectMaxMs: 30_000,
      authFailedRetryMs: 60_000,
      ...options,
    };
  }

  get state(): AmiConnectionState {
    return this._state;
  }
  get lastError(): string | null {
    return this._lastError;
  }
  get since(): Date | null {
    return this._since;
  }
  get connected(): boolean {
    return this._state === 'connected';
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket && this.connected) {
      try {
        await this.action('Logoff', {}, { timeoutMs: 1_000 });
      } catch {
        /* closing anyway */
      }
    }
    this.teardown('stopped');
  }

  /** Send an action and wait for its response (and list events if `opts.list`). */
  action(name: string, fields: Record<string, AmiFieldValue> = {}, opts: ActionOptions = {}): Promise<AmiResponse> {
    const socket = this.socket;
    if (!socket || (!this.connected && name !== 'Login')) {
      return Promise.reject(new AmiError('AMI is not connected', 'disconnected'));
    }
    const id = `cc-${++this.seq}`;
    let frame: string;
    try {
      // Header injection is refused before anything is written to the socket.
      frame = serializeAction(name, id, fields);
    } catch (err) {
      return Promise.reject(err as Error);
    }
    return new Promise<AmiResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AmiError(`AMI ${name} timed out`, 'timeout'));
      }, opts.timeoutMs ?? this.o.actionTimeoutMs);
      this.pending.set(id, { action: name, opts, response: null, events: [], resolve, reject, timer });
      socket.write(frame);
    });
  }

  // --- connection lifecycle -------------------------------------------------------------------

  private connect(): void {
    if (!this.running) return;
    this.setState('connecting', null);
    this.parser = new AmiParser();
    const socket = createConnection({ host: this.o.host, port: this.o.port });
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setKeepAlive(true, 30_000);
    socket.setTimeout(this.o.connectTimeoutMs);

    socket.on('timeout', () => {
      if (this._state === 'connecting') socket.destroy(new Error('connect timeout'));
    });
    socket.on('data', (chunk: string) => this.onData(socket, chunk));
    socket.on('error', (err) => {
      this._lastError = err.message;
      this.log('debug', `socket error: ${err.message}`);
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      const wasAuthFailed = this._state === 'auth_failed';
      this.teardown(this._lastError ?? 'connection closed');
      if (this.running) this.scheduleReconnect(wasAuthFailed);
    });
  }

  private onData(socket: Socket, chunk: string): void {
    let messages: AmiMessage[];
    try {
      const hadBanner = this.parser.banner !== null;
      messages = this.parser.push(chunk);
      if (!hadBanner && this.parser.banner !== null) this.onBanner(socket);
    } catch (err) {
      this._lastError = (err as Error).message;
      socket.destroy();
      return;
    }
    for (const msg of messages) this.dispatch(msg);
  }

  private onBanner(socket: Socket): void {
    socket.setTimeout(0);
    this.log('debug', `connected: ${this.parser.banner}`);
    const id = `cc-${++this.seq}`;
    this.loginId = id;
    const frame = serializeAction('Login', id, { Username: this.o.username, Secret: this.o.secret, Events: 'on' });
    const timer = setTimeout(() => {
      this.pending.delete(id);
      this._lastError = 'login timed out';
      socket.destroy();
    }, this.o.actionTimeoutMs);
    this.pending.set(id, {
      action: 'Login',
      opts: {},
      response: null,
      events: [],
      timer,
      resolve: () => this.onLoggedIn(),
      reject: (err) => {
        this._lastError = err.message;
        this.setState('auth_failed', err.message);
        socket.destroy();
      },
    });
    socket.write(frame);
  }

  private onLoggedIn(): void {
    this.attempt = 0;
    this._lastError = null;
    this.setState('connected', null);
    this.pingTimer = setInterval(() => {
      this.action('Ping', {}, { timeoutMs: Math.min(this.o.actionTimeoutMs, this.o.pingIntervalMs) }).catch((err) => {
        this.log('warn', `keepalive failed: ${(err as Error).message} — reconnecting`);
        this._lastError = 'keepalive timeout';
        this.socket?.destroy();
      });
    }, this.o.pingIntervalMs);
    this.pingTimer.unref();
  }

  private dispatch(msg: AmiMessage): void {
    const id = msg.actionid;
    const pending = id ? this.pending.get(id) : undefined;

    if ('response' in msg && !('event' in msg)) {
      if (!pending || !id) return;
      const ok = msg.response.toLowerCase() === 'success' || msg.response.toLowerCase() === 'follows';
      if (!ok) {
        this.finish(id, pending, new AmiError(msg.message || `AMI ${pending.action} failed`, 'rejected', msg));
        return;
      }
      pending.response = msg;
      const listStarted = msg.eventlist?.toLowerCase() === 'start' || /will follow/i.test(msg.message ?? '');
      if (!pending.opts.list || !listStarted) this.finish(id, pending);
      return;
    }

    if ('event' in msg) {
      if (pending && pending.opts.list && pending.response) {
        if ((pending.opts.until ?? isListComplete)(msg)) {
          if (!isListComplete(msg)) pending.events.push(msg);
          this.finish(id!, pending);
        } else {
          pending.events.push(msg);
        }
        return;
      }
      this.emit('event', msg);
    }
  }

  private finish(id: string, pending: Pending, error?: Error): void {
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (error) pending.reject(error);
    else pending.resolve({ fields: pending.response ?? {}, events: pending.events });
  }

  private teardown(reason: string): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.removeAllListeners('data');
    socket?.destroy();
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      if (id !== this.loginId) p.reject(new AmiError(`AMI disconnected (${reason})`, 'disconnected'));
    }
    this.pending.clear();
    this.loginId = null;
    if (this._state !== 'auth_failed') this.setState('disconnected', this.running ? reason : null);
  }

  private scheduleReconnect(authFailed: boolean): void {
    const base = authFailed
      ? this.o.authFailedRetryMs
      : Math.min(this.o.reconnectMaxMs, this.o.reconnectMinMs * 2 ** this.attempt++);
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.log(authFailed ? 'error' : 'warn', `AMI ${authFailed ? 'login failed' : 'disconnected'}; retry in ${delay} ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private setState(state: AmiConnectionState, error: string | null): void {
    if (state === this._state && state !== 'auth_failed') return;
    this._state = state;
    this._since = new Date();
    if (error) this._lastError = error;
    this.emit('state', state, error);
  }

  private log(level: 'debug' | 'log' | 'warn' | 'error', message: string): void {
    this.o.log?.(level, message);
  }
}
