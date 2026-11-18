import { type CallAttemptStatus, type TicketChangeAction, ticketCapabilities, ticketCode } from '@cc/shared';
import { Injectable, Logger } from '@nestjs/common';
import { RealtimeService } from '../realtime/realtime.service.js';
import { type TicketActor, ticketActor, ticketAudience } from './domain/ticket-workflow.js';
import { ticketFacts } from './ticket-presenter.service.js';
import { TicketsRepository } from './tickets.repository.js';
import type { TicketRow } from './tickets.tables.js';

/**
 * WebSocket notices about tickets, filtered per user with the same rule as GET /tickets:
 *  - `tickets.changed` to everyone who sees the ticket after the change;
 *  - `tickets.revoked` to those who saw it before and no longer do (forwarded, left the callback queue);
 *  - `tickets.unread` (counter) to executives of the regions involved (domain: `ticketAudience`).
 * Failures are logged and never break the action that triggered them.
 */
@Injectable()
export class TicketNotifier {
  private readonly logger = new Logger(TicketNotifier.name);

  constructor(
    private readonly repo: TicketsRepository,
    private readonly realtime: RealtimeService,
  ) {}

  private async actors(): Promise<TicketActor[]> {
    const [users, regions] = await Promise.all([this.repo.activeUsers(), this.repo.allExecutiveRegions()]);
    return users.map((u) => ticketActor(u, regions.get(u.id) ?? []));
  }

  async changed(
    before: TicketRow | null,
    after: TicketRow | null,
    action: TicketChangeAction,
    actor: { userId: number | null; label: string },
    extra: { attemptStatus?: CallAttemptStatus } = {},
  ): Promise<void> {
    try {
      const actors = await this.actors();
      const audience = ticketAudience(actors, before && ticketFacts(before), after && ticketFacts(after));
      const row = (after ?? before) as TicketRow;
      if (after && audience.changed.length > 0) {
        this.realtime.broadcast(
          'tickets.changed',
          {
            id: after.id,
            code: ticketCode(after.id),
            action,
            status: after.status,
            regionId: after.regionId,
            actor,
            ...(extra.attemptStatus ? { attemptStatus: extra.attemptStatus } : {}),
            at: new Date().toISOString(),
          },
          { userIds: audience.changed },
        );
      }
      if (audience.revoked.length > 0)
        this.realtime.broadcast(
          'tickets.revoked',
          { id: row.id, code: ticketCode(row.id) },
          { userIds: audience.revoked },
        );
      if (audience.unread.length > 0) await this.pushUnread(audience.unread);
    } catch (err) {
      this.logger.warn(`ticket notification failed: ${(err as Error).message}`);
    }
  }

  /** Re-send the unread counter to these executives (after reading a ticket, or a queue change). */
  async pushUnread(executives: TicketActor[]): Promise<void> {
    for (const e of executives) {
      try {
        const count = await this.repo.unreadCount(e.userId, [...e.regionIds]);
        this.realtime.broadcast('tickets.unread', { count }, { userIds: [e.userId] });
      } catch (err) {
        this.logger.warn(`unread counter failed for user ${e.userId}: ${(err as Error).message}`);
      }
    }
  }

  async pushUnreadFor(user: { id: number; role: string; extension: string | null }): Promise<void> {
    if (!ticketCapabilities(user).regionAlerts) return;
    await this.pushUnread([ticketActor(user, await this.repo.regionIdsOf(user.id))]);
  }
}
