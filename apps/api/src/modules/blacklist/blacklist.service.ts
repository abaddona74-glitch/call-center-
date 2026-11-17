import type {
  AddBlockedNumberRequestParsed,
  BlacklistResponse,
  BlacklistSyncResult,
  BlockedNumber,
  SessionUser,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { type Selectable, sql } from 'kysely';
import { type AmiCommands, InjectAmiCommands } from '../../common/ports/ami-commands.port.js';
import { AppConfig } from '../../config/app-config.js';
import { type DbHost, InjectDb } from '../../database/db.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { DisconnectedAmiCommands } from './ami-fallback.js';
import type { BlockedNumbersTable } from './blacklist.tables.js';
import { astdbFamily, astdbKeys, astdbValue } from './domain/astdb.js';

const AMI_TIMEOUT_MS = 5_000;
const RETRY_INTERVAL_MS = 60_000;

type Row = Selectable<BlockedNumbersTable>;

function toDto(r: Row): BlockedNumber {
  return {
    id: r.id,
    number: r.number,
    variants: [...r.variants],
    scope: r.scope,
    extension: r.extension,
    note: r.note,
    syncState: r.syncState,
    syncError: r.syncError,
    createdBy: r.createdByLabel,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`AMI did not answer within ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Blocked numbers. Postgres is the desired state; AstDB is brought in line through the AMI port
 * (DBPut/DBDel — never `asterisk -rx`). If AMI is down the change stays pending and is retried.
 * Global and per-operator lists are independent (legacy bug: adding to `blacklist_114` deleted the
 * number from the global `blacklist`).
 */
@Injectable()
export class BlacklistService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BlacklistService.name);
  private readonly ami: AmiCommands;
  private syncing: Promise<BlacklistSyncResult> | null = null;

  constructor(
    @InjectDb() private readonly txHost: DbHost,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
    private readonly scheduler: SchedulerRegistry,
    @Optional() @InjectAmiCommands() ami?: AmiCommands,
  ) {
    this.ami = ami ?? new DisconnectedAmiCommands();
  }

  onApplicationBootstrap(): void {
    const tick = () =>
      void this.syncPending().catch((err: unknown) => this.logger.warn(`blacklist sync failed: ${String(err)}`));
    this.scheduler.addInterval('blacklist-sync', setInterval(tick, RETRY_INTERVAL_MS));
  }

  get operatorExtensions(): string[] {
    return this.config.get('BLACKLIST_OPERATOR_EXTENSIONS');
  }

  async list(): Promise<BlacklistResponse> {
    const rows = await this.txHost.tx
      .selectFrom('blockedNumbers')
      .selectAll()
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return { items: rows.map(toDto), amiConnected: this.ami.connected, operatorExtensions: this.operatorExtensions };
  }

  async add(input: AddBlockedNumberRequestParsed, user: SessionUser): Promise<BlockedNumber> {
    if (input.scope === 'operator' && !this.operatorExtensions.includes(input.extension ?? '')) {
      throw new BadRequestException(
        `Extension ${input.extension} has no personal block list in the PBX (allowed: ${this.operatorExtensions.join(', ') || 'none'})`,
      );
    }
    const id = await this.addTx(input, user);
    await this.syncOne(id);
    this.changed();
    return toDto(await this.getRow(id));
  }

  @Transactional()
  private async addTx(input: AddBlockedNumberRequestParsed, user: SessionUser): Promise<number> {
    const variants = astdbKeys(input.number);
    const existing = await this.txHost.tx
      .selectFrom('blockedNumbers')
      .selectAll()
      .where('number', '=', input.number)
      .where('scope', '=', input.scope)
      .where(sql<string>`coalesce(extension, '')`, '=', input.extension ?? '')
      .forUpdate()
      .executeTakeFirst();
    let id: number;
    if (existing) {
      // Re-adding updates the note (legacy upsert) and revives a row that was being removed.
      await this.txHost.tx
        .updateTable('blockedNumbers')
        .set({ note: input.note, syncState: 'pending', syncError: null, updatedAt: sql<Date>`now()` })
        .where('id', '=', existing.id)
        .execute();
      id = existing.id;
    } else {
      const row = await this.txHost.tx
        .insertInto('blockedNumbers')
        .values({
          number: input.number,
          variants: sql<string[]>`${sql.val(variants)}::text[]`,
          scope: input.scope,
          extension: input.extension,
          note: input.note,
          createdByUserId: user.id,
          createdByLabel: user.username,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      id = row.id;
    }
    await this.audit.record(existing ? 'blacklist.update' : 'blacklist.add', {
      target: `blocked_number:${id}`,
      details: { number: input.number, scope: input.scope, extension: input.extension, note: input.note },
    });
    return id;
  }

  async remove(id: number, user: SessionUser): Promise<void> {
    await this.removeTx(id, user);
    await this.syncOne(id);
    this.changed();
  }

  @Transactional()
  private async removeTx(id: number, _user: SessionUser): Promise<void> {
    const row = await this.txHost.tx
      .selectFrom('blockedNumbers')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Blocked number not found');
    await this.txHost.tx
      .updateTable('blockedNumbers')
      .set({ syncState: 'removing', syncError: null, updatedAt: sql<Date>`now()` })
      .where('id', '=', id)
      .execute();
    await this.audit.record('blacklist.remove', {
      target: `blocked_number:${id}`,
      details: { number: row.number, scope: row.scope, extension: row.extension },
    });
  }

  /** Applies every pending change to AstDB (also runs every minute). */
  syncPending(): Promise<BlacklistSyncResult> {
    this.syncing ??= this.doSyncPending().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async doSyncPending(): Promise<BlacklistSyncResult> {
    if (!this.ami.connected) return { applied: 0, failed: 0, amiConnected: false };
    const rows = await this.txHost.tx
      .selectFrom('blockedNumbers')
      .select('id')
      .where('syncState', 'in', ['pending', 'error', 'removing'])
      .orderBy('id')
      .execute();
    let applied = 0;
    let failed = 0;
    for (const { id } of rows) {
      if (await this.syncOne(id)) applied++;
      else failed++;
    }
    if (applied + failed > 0) this.changed();
    return { applied, failed, amiConnected: this.ami.connected };
  }

  /** Brings one row's AstDB keys in line. Returns true when AstDB now matches. */
  private async syncOne(id: number): Promise<boolean> {
    const row = await this.txHost.tx.selectFrom('blockedNumbers').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return true;
    if (row.syncState === 'synced') return true;
    if (!this.ami.connected) {
      if (row.syncState !== 'removing') await this.markState(id, 'pending', 'AMI is not connected');
      return false;
    }
    const family = astdbFamily(row.scope, row.extension);
    try {
      if (row.syncState === 'removing') {
        for (const key of row.variants) await withTimeout(this.ami.dbDel(family, key), AMI_TIMEOUT_MS);
        await this.txHost.tx
          .deleteFrom('blockedNumbers')
          .where('id', '=', id)
          .where('syncState', '=', 'removing')
          .execute();
      } else {
        const value = astdbValue(row.note);
        for (const key of row.variants) await withTimeout(this.ami.dbPut(family, key, value), AMI_TIMEOUT_MS);
        await this.txHost.tx
          .updateTable('blockedNumbers')
          .set({ syncState: 'synced', syncError: null, syncedAt: sql<Date>`now()` })
          .where('id', '=', id)
          // a concurrent edit (new note) or removal keeps its own state
          .where('note', '=', row.note)
          .where('syncState', '!=', 'removing')
          .execute();
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`AstDB ${family} sync of #${id} failed: ${message}`);
      if (row.syncState !== 'removing') await this.markState(id, 'error', message.slice(0, 300));
      else {
        await this.txHost.tx
          .updateTable('blockedNumbers')
          .set({ syncError: message.slice(0, 300) })
          .where('id', '=', id)
          .execute();
      }
      return false;
    }
  }

  private async markState(id: number, state: 'pending' | 'error', error: string): Promise<void> {
    await this.txHost.tx
      .updateTable('blockedNumbers')
      .set({ syncState: state, syncError: error })
      .where('id', '=', id)
      .execute();
  }

  private async getRow(id: number): Promise<Row> {
    const row = await this.txHost.tx.selectFrom('blockedNumbers').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundException('Blocked number not found');
    return row;
  }

  private changed(): void {
    this.realtime.broadcast('blacklist.changed', { at: new Date().toISOString() }, { minRole: 'admin' });
  }
}
