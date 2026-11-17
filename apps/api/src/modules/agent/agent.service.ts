import {
  type AgentCallEventRequest,
  type AgentDevice,
  type AgentDeviceListResponse,
  type AgentEventsQuery,
  type AgentEventsResponse,
  type AgentHeartbeatRequest,
  type AgentHeartbeatResponse,
  type AgentRelease,
  type AgentStatus,
  type AgentStatusListResponse,
  AgentSyncBatchItemSchema,
  type AgentSyncBatchItem,
  type AgentUpdateLog,
  type AgentUpdateLogRequest,
  type AgentVersionResponse,
  BUSINESS_TIMEZONE,
  type CreateAgentDeviceResponse,
  type SessionUser,
  normalizeUzPhone,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { type Insertable, type Selectable, sql } from 'kysely';
import { AppConfig } from '../../config/app-config.js';
import { type DbHost, InjectDb } from '../../database/db.js';
import { AuditService } from '../audit/audit.service.js';
import { businessDate, dayBounds, parseBusinessDateTime } from '../callbacks/domain/working-calendar.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { AgentAuth } from './agent-auth.guard.js';
import type { AgentCallEventsTable, AgentDevicesTable } from './agent.tables.js';
import {
  agentKeyPrefix,
  compareVersions,
  generateAgentKey,
  hashAgentKey,
  isAgentOnline,
  normalizeAgentEventType,
  plausibleAgentTime,
} from './domain/agent-rules.js';

const BATCH_CHUNK = 500;
const UPDATE_LOG_RETENTION_DAYS = 90;

type CallFields = Pick<
  AgentCallEventRequest,
  'eventType' | 'callerId' | 'durationSec' | 'startTime' | 'endTime' | 'details'
>;

/**
 * Desktop agent ingest + admin. Agent data lives in its own tables and is never merged into
 * PBX statistics; callbacks are driven by PBX events only.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  /** Last broadcast state per extension, to push only transitions. */
  private readonly known = new Map<string, { online: boolean; version: string | null }>();

  constructor(
    @InjectDb() private readonly txHost: DbHost,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------ ingest (agents)

  /** A keyed device may only report for its own extension. */
  private extensionFor(auth: AgentAuth, operatorId: string): string {
    if (auth.mode === 'key' && auth.extension !== operatorId) {
      throw new ForbiddenException(`This agent key belongs to extension ${auth.extension}`);
    }
    return operatorId;
  }

  async heartbeat(auth: AgentAuth, body: AgentHeartbeatRequest): Promise<AgentHeartbeatResponse> {
    const extension = this.extensionFor(auth, body.operatorId);
    await this.touch(auth, extension, body.hostname ?? null, body.appVersion ?? body.version ?? null);
    const latest = await this.latest();
    return { success: true, timestamp: Date.now(), latestVersion: latest.version, updateUrl: latest.updateUrl };
  }

  async callEvent(auth: AgentAuth, body: AgentCallEventRequest): Promise<void> {
    const extension = this.extensionFor(auth, body.operatorId);
    await this.touch(auth, extension, body.hostname ?? null, null);
    await this.insertEvents([this.toEventRow(auth, extension, body.hostname ?? null, body)]);
  }

  async syncBatch(
    auth: AgentAuth,
    operatorId: string,
    hostname: string | null,
    calls: readonly unknown[],
  ): Promise<{ inserted: number; skipped: number }> {
    const extension = this.extensionFor(auth, operatorId);
    await this.touch(auth, extension, hostname, null);
    const rows: Insertable<AgentCallEventsTable>[] = [];
    let invalid = 0;
    for (const item of calls) {
      const parsed = AgentSyncBatchItemSchema.safeParse(item);
      if (parsed.success) rows.push(this.toEventRow(auth, extension, hostname, parsed.data));
      else invalid++;
    }
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_CHUNK)
      inserted += await this.insertEvents(rows.slice(i, i + BATCH_CHUNK));
    return { inserted, skipped: invalid + (rows.length - inserted) };
  }

  async updateLog(auth: AgentAuth, body: AgentUpdateLogRequest): Promise<void> {
    const extension = this.extensionFor(auth, body.operatorId);
    await this.touch(auth, extension, body.hostname ?? null, body.version ?? null);
    const row = await this.txHost.tx
      .insertInto('agentUpdateLogs')
      .values({
        extension,
        deviceId: auth.deviceId,
        hostname: body.hostname ?? null,
        version: body.version ?? null,
        targetVersion: body.targetVersion ?? null,
        step: body.step,
        message: body.message,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    this.realtime.broadcast('agents.updateLog', this.updateLogDto(row), { minRole: 'admin' });
  }

  async version(): Promise<AgentVersionResponse> {
    const latest = await this.latest();
    return {
      success: true,
      latestVersion: latest.version,
      updateUrl: latest.updateUrl,
      releaseNotes: latest.releaseNotes,
      minVersion: latest.minVersion,
      lastReleaseTime: latest.createdAt,
    };
  }

  private toEventRow(
    auth: AgentAuth,
    extension: string,
    hostname: string | null,
    e: CallFields | AgentSyncBatchItem,
  ): Insertable<AgentCallEventsTable> {
    const now = new Date();
    const startedAt = plausibleAgentTime(
      e.startTime ? parseBusinessDateTime(e.startTime, BUSINESS_TIMEZONE) : null,
      now,
    );
    const endedAt = plausibleAgentTime(e.endTime ? parseBusinessDateTime(e.endTime, BUSINESS_TIMEZONE) : null, now);
    return {
      deviceId: auth.deviceId,
      authMode: auth.mode,
      extension,
      eventType: normalizeAgentEventType(e.eventType),
      rawEventType: e.eventType,
      callerId: e.callerId,
      phone: normalizeUzPhone(e.callerId),
      durationSec: e.durationSec,
      startedAt,
      endedAt,
      rawStartTime: e.startTime ?? '',
      eventAt: startedAt ?? now,
      hostname,
      details: e.details,
      ip: auth.ip,
    };
  }

  /** Inserts events, ignoring re-sent ones; returns how many were new. */
  private async insertEvents(rows: Insertable<AgentCallEventsTable>[]): Promise<number> {
    if (rows.length === 0) return 0;
    const res = await this.txHost.tx
      .insertInto('agentCallEvents')
      .values(rows)
      .onConflict((oc) =>
        oc.columns(['extension', 'eventType', 'callerId', 'rawStartTime']).where('rawStartTime', '<>', '').doNothing(),
      )
      .executeTakeFirst();
    return Number(res.numInsertedOrUpdatedRows ?? 0);
  }

  /** Records that the agent of `extension` is alive. */
  private async touch(
    auth: AgentAuth,
    extension: string,
    hostname: string | null,
    version: string | null,
  ): Promise<void> {
    const now = new Date();
    await this.txHost.tx
      .insertInto('agentStatus')
      .values({
        extension,
        deviceId: auth.deviceId,
        authMode: auth.mode,
        hostname,
        appVersion: version,
        ip: auth.ip,
        lastSeenAt: now,
      })
      .onConflict((oc) =>
        oc.column('extension').doUpdateSet({
          deviceId: auth.deviceId,
          authMode: auth.mode,
          hostname: sql<string | null>`coalesce(${hostname}, agent_status.hostname)`,
          appVersion: sql<string | null>`coalesce(${version}, agent_status.app_version)`,
          ip: auth.ip,
          lastSeenAt: now,
        }),
      )
      .execute();
    if (auth.mode === 'key') {
      await this.txHost.tx
        .updateTable('agentDevices')
        .set({
          lastSeenAt: now,
          lastIp: auth.ip,
          hostname: sql<string | null>`coalesce(${hostname}, hostname)`,
          appVersion: sql<string | null>`coalesce(${version}, app_version)`,
        })
        .where('id', '=', auth.deviceId)
        .execute();
    }
    const prev = this.known.get(extension);
    if (!prev || !prev.online || (version !== null && prev.version !== version)) {
      const status = await this.statusOf(extension);
      if (status) this.publishStatus(status);
    }
  }

  // ------------------------------------------------------------ admin

  async listDevices(): Promise<AgentDeviceListResponse> {
    const rows = await this.txHost.tx
      .selectFrom('agentDevices')
      .selectAll()
      .orderBy('revokedAt', 'desc')
      .orderBy('extension')
      .orderBy('id')
      .execute();
    return { items: rows.map((r) => this.deviceDto(r)), compatMode: this.config.get('AGENT_COMPAT_MODE') };
  }

  async createDevice(name: string, extension: string, user: SessionUser): Promise<CreateAgentDeviceResponse> {
    const apiKey = generateAgentKey();
    const row = await this.createDeviceTx(name, extension, apiKey, user);
    return { device: this.deviceDto(row), apiKey };
  }

  @Transactional()
  private async createDeviceTx(name: string, extension: string, apiKey: string, user: SessionUser) {
    const row = await this.txHost.tx
      .insertInto('agentDevices')
      .values({
        name,
        extension,
        keyHash: hashAgentKey(apiKey),
        keyPrefix: agentKeyPrefix(apiKey),
        createdByUserId: user.id,
        createdByLabel: user.username,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record('agent.device.create', {
      target: `agent_device:${row.id}`,
      details: { name, extension, keyPrefix: row.keyPrefix },
    });
    return row;
  }

  async revokeDevice(id: number, user: SessionUser): Promise<AgentDevice> {
    return this.deviceDto(await this.revokeDeviceTx(id, user));
  }

  @Transactional()
  private async revokeDeviceTx(id: number, user: SessionUser) {
    const row = await this.txHost.tx
      .updateTable('agentDevices')
      .set({
        revokedAt: sql<Date>`coalesce(revoked_at, now())`,
        revokedByLabel: sql<string>`coalesce(revoked_by_label, ${user.username})`,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Agent device not found');
    await this.audit.record('agent.device.revoke', {
      target: `agent_device:${id}`,
      details: { name: row.name, extension: row.extension },
    });
    return row;
  }

  async statuses(): Promise<AgentStatusListResponse> {
    const latest = await this.latest();
    const rows = await this.statusRows();
    return { items: rows.map((r) => this.statusDto(r, latest.version)), latestVersion: latest.version };
  }

  async releases(): Promise<AgentRelease[]> {
    const rows = await this.txHost.tx.selectFrom('agentReleases').selectAll().orderBy('id', 'desc').limit(50).execute();
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      releaseNotes: r.releaseNotes,
      minVersion: r.minVersion,
      updateUrl: r.updateUrl,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdByLabel,
    }));
  }

  @Transactional()
  async createRelease(
    input: { version: string; releaseNotes: string; minVersion: string | null; updateUrl?: string },
    user: SessionUser,
  ): Promise<AgentRelease> {
    const row = await this.txHost.tx
      .insertInto('agentReleases')
      .values({
        version: input.version,
        releaseNotes: input.releaseNotes,
        minVersion: input.minVersion,
        updateUrl: input.updateUrl ?? this.config.get('AGENT_DEFAULT_UPDATE_URL'),
        createdByUserId: user.id,
        createdByLabel: user.username,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record('agent.release.create', { target: `agent_release:${row.id}`, details: input });
    return {
      id: row.id,
      version: row.version,
      releaseNotes: row.releaseNotes,
      minVersion: row.minVersion,
      updateUrl: row.updateUrl,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdByLabel,
    };
  }

  async updateLogs(): Promise<AgentUpdateLog[]> {
    const rows = await this.txHost.tx
      .selectFrom('agentUpdateLogs')
      .selectAll()
      .orderBy('at', 'desc')
      .orderBy('id', 'desc')
      .limit(200)
      .execute();
    return rows.map((r) => this.updateLogDto(r));
  }

  async events(q: AgentEventsQuery): Promise<AgentEventsResponse> {
    const day = q.date === 'today' ? businessDate(new Date(), BUSINESS_TIMEZONE) : q.date;
    const { start, end } = dayBounds(day, BUSINESS_TIMEZONE);
    let base = this.txHost.tx.selectFrom('agentCallEvents').where('eventAt', '>=', start).where('eventAt', '<', end);
    if (q.extension) base = base.where('extension', '=', q.extension);
    const { total } = await base.select(sql<number>`count(*)::int`.as('total')).executeTakeFirstOrThrow();
    const rows = await base
      .selectAll()
      .orderBy('eventAt', 'desc')
      .orderBy('id', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id,
        extension: r.extension,
        eventType: r.eventType,
        rawEventType: r.rawEventType,
        callerId: r.callerId,
        phone: r.phone,
        durationSec: r.durationSec,
        startedAt: r.startedAt?.toISOString() ?? null,
        endedAt: r.endedAt?.toISOString() ?? null,
        hostname: r.hostname,
        details: r.details,
        authMode: r.authMode,
        receivedAt: r.receivedAt.toISOString(),
      })),
    };
  }

  // ------------------------------------------------------------ housekeeping

  /** Pushes online → offline transitions (agents stop sending heartbeats silently). */
  @Interval(15_000)
  async detectOffline(): Promise<void> {
    try {
      const latest = await this.latest();
      for (const row of await this.statusRows()) {
        const prev = this.known.get(row.extension);
        if (prev?.online && !isAgentOnline(row.lastSeenAt)) this.publishStatus(this.statusDto(row, latest.version));
      }
    } catch (err) {
      this.logger.warn(`agent offline check failed: ${String(err)}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeUpdateLogs(): Promise<void> {
    await this.txHost.tx
      .deleteFrom('agentUpdateLogs')
      .where('at', '<', sql<Date>`now() - make_interval(days => ${UPDATE_LOG_RETENTION_DAYS})`)
      .execute();
  }

  // ------------------------------------------------------------ helpers

  private async latest(): Promise<{
    version: string;
    updateUrl: string;
    releaseNotes: string;
    minVersion: string | null;
    createdAt: string | null;
  }> {
    const row = await this.txHost.tx
      .selectFrom('agentReleases')
      .selectAll()
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      return {
        version: this.config.get('AGENT_DEFAULT_VERSION'),
        updateUrl: this.config.get('AGENT_DEFAULT_UPDATE_URL'),
        releaseNotes: '',
        minVersion: null,
        createdAt: null,
      };
    }
    return {
      version: row.version,
      updateUrl: row.updateUrl,
      releaseNotes: row.releaseNotes,
      minVersion: row.minVersion,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private statusRows() {
    return this.txHost.tx
      .selectFrom('agentStatus as s')
      .leftJoin('agentDevices as d', 'd.id', 's.deviceId')
      .selectAll('s')
      .select('d.name as deviceName')
      .orderBy('s.extension')
      .execute();
  }

  private async statusOf(extension: string) {
    const rows = await this.statusRows();
    const row = rows.find((r) => r.extension === extension);
    return row ? this.statusDto(row, (await this.latest()).version) : null;
  }

  private statusDto(r: Awaited<ReturnType<AgentService['statusRows']>>[number], latestVersion: string): AgentStatus {
    return {
      extension: r.extension,
      deviceId: r.deviceId,
      deviceName: r.deviceName,
      authMode: r.authMode,
      hostname: r.hostname,
      appVersion: r.appVersion,
      ip: r.ip,
      lastSeenAt: r.lastSeenAt.toISOString(),
      online: isAgentOnline(r.lastSeenAt),
      isLatest: r.appVersion !== null && compareVersions(r.appVersion, latestVersion) >= 0,
    };
  }

  private publishStatus(status: AgentStatus): void {
    this.known.set(status.extension, { online: status.online, version: status.appVersion });
    this.realtime.broadcast('agents.status', status, { minRole: 'admin' });
  }

  private deviceDto(r: Selectable<AgentDevicesTable>): AgentDevice {
    return {
      id: r.id,
      name: r.name,
      extension: r.extension,
      keyPrefix: r.keyPrefix,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdByLabel,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      revokedBy: r.revokedByLabel,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      lastIp: r.lastIp,
      hostname: r.hostname,
      appVersion: r.appVersion,
      online: r.revokedAt === null && isAgentOnline(r.lastSeenAt),
    };
  }

  private updateLogDto(r: {
    id: number;
    at: Date;
    extension: string;
    hostname: string | null;
    version: string | null;
    targetVersion: string | null;
    step: AgentUpdateLog['step'];
    message: string;
  }): AgentUpdateLog {
    return {
      id: r.id,
      at: r.at.toISOString(),
      extension: r.extension,
      hostname: r.hostname,
      version: r.version,
      targetVersion: r.targetVersion,
      step: r.step,
      message: r.message,
    };
  }
}
