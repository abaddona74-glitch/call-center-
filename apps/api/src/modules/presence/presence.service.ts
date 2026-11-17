import { type OnlineUser, telephonyAccess } from '@cc/shared';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { RealtimeService } from '../realtime/realtime.service.js';
import { aggregateOnline, signatureOf } from './domain/aggregate.js';

const CHECK_MS = 3_000;

/**
 * "Who is online": built from the authenticated WebSocket connections (no extra storage).
 * Pushes `presence.online` to users who may see it whenever someone connects, leaves,
 * switches page or tab visibility. Multiplayer cursors are intentionally not ported.
 */
@Injectable()
export class PresenceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private lastSignature = '';

  constructor(private readonly realtime: RealtimeService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.check(), CHECK_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  online(): OnlineUser[] {
    return aggregateOnline(this.realtime.list());
  }

  private check(): void {
    const list = this.online();
    const signature = signatureOf(list);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.realtime.broadcastEach('presence.online', (user) => (telephonyAccess(user.role).seeAll ? list : undefined));
  }
}
