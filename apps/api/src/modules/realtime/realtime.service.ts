import {
  type Permission,
  type Role,
  type RoleLevel,
  type ServerEventName,
  type ServerEvents,
  type SessionUser,
  WS_CLOSE,
  hasPermission,
  hasRoleAtLeast,
} from '@cc/shared';
import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';

interface Connection {
  user: SessionUser;
  sessionId: string;
  connectedAt: number;
  lastPingAt: number;
  /** From the client's presence.ping: current page and whether the tab is in the foreground. */
  tab: string | null;
  visible: boolean;
}

export interface BroadcastFilter {
  /** Only users with this permission (preferred, see ROLE_PERMISSIONS in @cc/shared). */
  permission?: Permission;
  /** @deprecated minimum role level ('admin' = executive); use `permission`. */
  minRole?: RoleLevel;
  /** Only these users. */
  userIds?: number[];
}

/**
 * Registry of authenticated WebSocket connections + typed broadcasting.
 * Modules push events with `realtime.broadcast('calls.hangup', payload, { permission: 'monitor.view' })`.
 * Payload types come from `ServerEvents` in @cc/shared.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly connections = new Map<WebSocket, Connection>();

  register(socket: WebSocket, user: SessionUser, sessionId: string): void {
    this.connections.set(socket, {
      user,
      sessionId,
      connectedAt: Date.now(),
      lastPingAt: Date.now(),
      tab: null,
      visible: true,
    });
  }

  unregister(socket: WebSocket): void {
    this.connections.delete(socket);
  }

  touch(socket: WebSocket, info: { tab?: unknown; visible?: unknown } = {}): void {
    const c = this.connections.get(socket);
    if (!c) return;
    c.lastPingAt = Date.now();
    // Client data: keep only a short path-like string and a boolean.
    if (typeof info.tab === 'string') c.tab = /^\/[\w\-/]{0,80}$/.test(info.tab) ? info.tab : null;
    if (typeof info.visible === 'boolean') c.visible = info.visible;
  }

  send<K extends ServerEventName>(socket: WebSocket, type: K, data: ServerEvents[K]): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, data }));
  }

  broadcast<K extends ServerEventName>(type: K, data: ServerEvents[K], filter: BroadcastFilter = {}): number {
    const frame = JSON.stringify({ type, data });
    let sent = 0;
    for (const [socket, conn] of this.connections) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (filter.permission && !hasPermission(conn.user, filter.permission)) continue;
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
  broadcastEach<K extends ServerEventName>(
    type: K,
    project: (user: SessionUser) => ServerEvents[K] | undefined,
  ): number {
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
  list(): Array<{
    userId: number;
    username: string;
    role: Role;
    extension: string | null;
    connectedAt: number;
    lastPingAt: number;
    tab: string | null;
    visible: boolean;
  }> {
    return [...this.connections.values()].map((c) => ({
      userId: c.user.id,
      username: c.user.username,
      role: c.user.role,
      extension: c.user.extension,
      connectedAt: c.connectedAt,
      lastPingAt: c.lastPingAt,
      tab: c.tab,
      visible: c.visible,
    }));
  }

  get size(): number {
    this.logger.verbose(`connections: ${this.connections.size}`);
    return this.connections.size;
  }
}
