import { type Role, type ServerEventName, type ServerEvents, type SessionUser, WS_CLOSE, hasRoleAtLeast } from '@cc/shared';
import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';

interface Connection {
  user: SessionUser;
  sessionId: string;
  connectedAt: number;
  lastPingAt: number;
}

export interface BroadcastFilter {
  /** Only users with at least this role. */
  minRole?: Role;
  /** Only these users. */
  userIds?: number[];
}

/**
 * Registry of authenticated WebSocket connections + typed broadcasting.
 * Modules push events with `realtime.broadcast('calls.hangup', payload, { minRole: 'admin' })`.
 * Payload types come from `ServerEvents` in @cc/shared.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly connections = new Map<WebSocket, Connection>();

  register(socket: WebSocket, user: SessionUser, sessionId: string): void {
    this.connections.set(socket, { user, sessionId, connectedAt: Date.now(), lastPingAt: Date.now() });
  }

  unregister(socket: WebSocket): void {
    this.connections.delete(socket);
  }

  touch(socket: WebSocket): void {
    const c = this.connections.get(socket);
    if (c) c.lastPingAt = Date.now();
  }

  send<K extends ServerEventName>(socket: WebSocket, type: K, data: ServerEvents[K]): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, data }));
  }

  broadcast<K extends ServerEventName>(type: K, data: ServerEvents[K], filter: BroadcastFilter = {}): number {
    const frame = JSON.stringify({ type, data });
    let sent = 0;
    for (const [socket, conn] of this.connections) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (filter.minRole && !hasRoleAtLeast(conn.user.role, filter.minRole)) continue;
      if (filter.userIds && !filter.userIds.includes(conn.user.id)) continue;
      socket.send(frame);
      sent++;
    }
    return sent;
  }

  /**
   * Per-user payloads (e.g. redacted for operators). `project` runs once per connection; returning
   * `undefined` skips that user. Results that are the same object are serialized once.
   */
  broadcastEach<K extends ServerEventName>(type: K, project: (user: SessionUser) => ServerEvents[K] | undefined): number {
    const frames = new Map<ServerEvents[K], string>();
    let sent = 0;
    for (const [socket, conn] of this.connections) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const data = project(conn.user);
      if (data === undefined) continue;
      let frame = frames.get(data);
      if (!frame) {
        frame = JSON.stringify({ type, data });
        frames.set(data, frame);
      }
      socket.send(frame);
      sent++;
    }
    return sent;
  }

  /** Close every socket of a revoked session / of a user (password change, deactivation). */
  terminate(match: { sessionId?: string; userId?: number }, reason: string): void {
    for (const [socket, conn] of this.connections) {
      if ((match.sessionId && conn.sessionId === match.sessionId) || (match.userId && conn.user.id === match.userId)) {
        this.send(socket, 'session.terminated', { reason });
        socket.close(WS_CLOSE.sessionTerminated, reason);
        this.connections.delete(socket);
      }
    }
  }

  /** Online users (one entry per connection). */
  list(): Array<{ userId: number; username: string; role: Role; connectedAt: number; lastPingAt: number }> {
    return [...this.connections.values()].map((c) => ({
      userId: c.user.id,
      username: c.user.username,
      role: c.user.role,
      connectedAt: c.connectedAt,
      lastPingAt: c.lastPingAt,
    }));
  }

  get size(): number {
    this.logger.verbose(`connections: ${this.connections.size}`);
    return this.connections.size;
  }
}
