import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls/app-cls.js';
import { type DbHost, InjectDb } from '../../database/db.js';

/**
 * Append-only audit trail of security-relevant and business-relevant actions:
 * logins, user/role changes, manual stat edits, deleting callbacks, etc.
 * Actor, IP and request id are taken from the request context (CLS) automatically,
 * and the insert joins the current @Transactional() transaction if there is one.
 *
 *   await this.audit.record('callbacks.dismiss', { target: `callback:${id}`, details: { reason } });
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectDb() private readonly txHost: DbHost,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async record(action: string, opts: { target?: string; details?: unknown; actorLabel?: string } = {}): Promise<void> {
    const user = this.cls.isActive() ? this.cls.get('user') : undefined;
    // "Log in as": the real person is the superuser; the label shows both ("boss → op101").
    const by = user?.impersonation?.by;
    await this.txHost.tx
      .insertInto('auditLog')
      .values({
        actorUserId: by?.id ?? user?.id ?? null,
        actorLabel: opts.actorLabel ?? (by ? `${by.username} → ${user!.username}` : (user?.username ?? 'system')),
        action,
        target: opts.target ?? null,
        details: opts.details === undefined ? null : JSON.stringify(opts.details),
        ip: this.cls.isActive() ? (this.cls.get('ip') ?? null) : null,
        requestId: this.cls.isActive() ? (this.cls.getId() ?? null) : null,
      })
      .execute();
  }
}
