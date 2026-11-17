import type { IncomingMessage } from 'node:http';
import { type ClientEvents, WS_CLOSE, WS_PATH } from '@cc/shared';
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type WebSocket from 'ws';
import { extractSessionToken } from '../../common/http/cookies.js';
import { SessionsService } from '../auth/sessions.service.js';
import { RealtimeService } from './realtime.service.js';

/**
 * Single WebSocket endpoint for all live data. Authenticated by the same session cookie
 * as HTTP; unauthenticated sockets are closed with 4401.
 * Frames: `{ "type": "...", "data": ... }` (see @cc/shared realtime.ts); the WsAdapter in
 * main.ts maps `type` to Nest's `event` so @SubscribeMessage('<type>') works.
 */
@WebSocketGateway({ path: WS_PATH })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly realtime: RealtimeService,
  ) {}

  async handleConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
    try {
      const session = await this.sessions.validate(extractSessionToken(req));
      if (!session) {
        socket.close(WS_CLOSE.unauthorized, 'unauthorized');
        return;
      }
      this.realtime.register(socket, session.user, session.sessionId);
      this.realtime.send(socket, 'session.ready', {
        userId: session.user.id,
        role: session.user.role,
        serverTime: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error(`ws auth failed: ${String(err)}`);
      socket.close(WS_CLOSE.unauthorized, 'unauthorized');
    }
  }

  handleDisconnect(socket: WebSocket): void {
    this.realtime.unregister(socket);
  }

  @SubscribeMessage('presence.ping')
  onPing(@ConnectedSocket() socket: WebSocket, @MessageBody() data: ClientEvents['presence.ping']): void {
    this.realtime.touch(socket, data && typeof data === 'object' ? data : {});
  }
}
