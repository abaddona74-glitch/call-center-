import {
  type AuditActions,
  AuditActionsSchema,
  type AuditPage,
  AuditPageSchema,
  AuditQuerySchema,
  BUSINESS_TIMEZONE,
} from '@cc/shared';
import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import { sql } from 'kysely';
import { DateTime } from 'luxon';
import type { z } from 'zod';
import { Roles } from '../../common/decorators/auth.decorators.js';
import { type DbHost, InjectDb } from '../../database/db.js';

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Read-only audit log viewer (admin+). */
@Controller('audit')
@Roles('admin')
export class AuditController {
  constructor(@InjectDb() private readonly txHost: DbHost) {}

  @Get()
  @SerializeOptions({ schema: AuditPageSchema })
  async list(@Query({ schema: AuditQuerySchema }) q: z.output<typeof AuditQuerySchema>): Promise<AuditPage> {
    let query = this.txHost.tx.selectFrom('auditLog');
    if (q.action) {
      const prefix = q.action.endsWith('*') ? q.action.slice(0, -1) : q.action.endsWith('.') ? q.action : null;
      query =
        prefix !== null
          ? query.where('action', 'like', `${escapeLike(prefix)}%`)
          : query.where('action', '=', q.action);
    }
    if (q.actor) query = query.where('actorLabel', 'ilike', `%${escapeLike(q.actor)}%`);
    if (q.target) query = query.where('target', 'ilike', `%${escapeLike(q.target)}%`);
    if (q.from) {
      query = query.where('at', '>=', DateTime.fromISO(q.from, { zone: BUSINESS_TIMEZONE }).startOf('day').toJSDate());
    }
    if (q.to) {
      query = query.where('at', '<', DateTime.fromISO(q.to, { zone: BUSINESS_TIMEZONE }).plus({ days: 1 }).startOf('day').toJSDate());
    }

    const [{ total }, rows] = await Promise.all([
      query.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow(),
      query
        .select(['id', 'at', 'actorUserId', 'actorLabel', 'action', 'target', 'details', 'ip', 'requestId'])
        .orderBy('at', 'desc')
        .orderBy('id', 'desc')
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize)
        .execute(),
    ]);
    return {
      items: rows.map((r) => ({ ...r, at: r.at.toISOString(), details: r.details ?? null })),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(total),
    };
  }

  /** Distinct actions for the filter dropdown. */
  @Get('actions')
  @SerializeOptions({ schema: AuditActionsSchema })
  async actions(): Promise<AuditActions> {
    const rows = await this.txHost.tx
      .selectFrom('auditLog')
      .select('action')
      .distinct()
      .orderBy(sql`action`)
      .limit(500)
      .execute();
    return { items: rows.map((r) => r.action) };
  }
}
