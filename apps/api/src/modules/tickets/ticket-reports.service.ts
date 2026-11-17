import { BUSINESS_TIMEZONE, type SessionUser, type TicketReport, type TicketReportQuery } from '@cc/shared';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { buildTicketReport } from './domain/ticket-report.js';
import { TicketPresenter } from './ticket-presenter.service.js';
import { TicketsRepository } from './tickets.repository.js';

const MAX_DAYS = 366;

/** Ticket reports (replace the removed "call topics" analytics). Executives see only their regions. */
@Injectable()
export class TicketReportsService {
  constructor(
    private readonly repo: TicketsRepository,
    private readonly presenter: TicketPresenter,
  ) {}

  async report(user: SessionUser, q: TicketReportQuery): Promise<TicketReport> {
    const actor = await this.presenter.actorFor(user);
    if (!actor.capabilities.reports) throw new ForbiddenException('No access to ticket reports');
    const from = DateTime.fromISO(q.from, { zone: BUSINESS_TIMEZONE }).startOf('day');
    const to = DateTime.fromISO(q.to, { zone: BUSINESS_TIMEZONE }).startOf('day').plus({ days: 1 });
    if (!from.isValid || !to.isValid) throw new BadRequestException('Invalid date');
    if (to <= from) throw new BadRequestException('`from` must not be after `to`');
    if (to.diff(from, 'days').days > MAX_DAYS)
      throw new BadRequestException(`Date range is limited to ${MAX_DAYS} days`);

    const regionScope = actor.capabilities.viewAll ? null : [...actor.regionIds];
    const [rows, refs] = await Promise.all([
      this.repo.createdBetween(from.toJSDate(), to.toJSDate(), regionScope),
      this.presenter.refs(),
    ]);
    return buildTicketReport(
      rows.map((r) => ({
        status: r.status,
        regionId: r.regionId,
        categoryId: r.categoryId,
        executiveUserId: r.resolvedByUserId ?? r.assigneeUserId,
        executiveLabel: r.resolvedByLabel ?? r.assigneeLabel,
        createdAt: new Date(r.createdAt),
        dueAt: r.dueAt ? new Date(r.dueAt) : null,
        resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
      })),
      { regions: refs.regions, categories: refs.categories },
      { from: q.from, to: q.to },
      new Date(),
    );
  }
}
