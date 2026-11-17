import type { SessionUser } from '@cc/shared';
import { HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LRUCache } from 'lru-cache';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import { AuditService } from '../audit/audit.service.js';
import { recordingFileCandidates } from '../recordings/domain/cdr-recording.js';
import { type PreparedStream, RecordingsService } from '../recordings/recordings.service.js';
import { type RecordingCheckResult, afterCheck } from './domain/recording-link.js';
import { TicketPresenter } from './ticket-presenter.service.js';
import { TicketsRepository } from './tickets.repository.js';
import { TicketsService } from './tickets.service.js';
import type { TicketCallRow } from './tickets.tables.js';

const BATCH = 20;

/**
 * Attaches recordings to tickets: the ticket's own call and every callback call. The CDR row (and its
 * `recordingfile`) exists only after the call ended, so pending rows are retried until a deadline
 * (TICKETS_RECORDING_LOOKUP_MINUTES after the end). Streams are served only to users who see the ticket.
 */
@Injectable()
export class TicketRecordingsService {
  private readonly logger = new Logger(TicketRecordingsService.name);
  private readonly playAudit = new LRUCache<string, true>({ max: 10_000, ttl: 10 * 60_000 });
  private running = false;

  constructor(
    private readonly repo: TicketsRepository,
    private readonly tickets: TicketsService,
    private readonly presenter: TicketPresenter,
    private readonly pbxCalls: PbxCallsService,
    private readonly recordings: RecordingsService,
    private readonly audit: AuditService,
  ) {}

  @Interval(15_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.linkDue(new Date());
    } catch (err) {
      this.logger.warn(`recording lookup failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** One pass over due rows (public for tests). */
  async linkDue(now: Date): Promise<number> {
    let found = 0;
    for (const row of await this.repo.dueRecordings(now, BATCH)) {
      const result = row.callId ? await this.check(row) : ({ kind: 'missing' } as const);
      const next = afterCheck(result, new Date(row.recordingDeadline), now);
      await this.repo.updateCall(row.id, {
        recordingStatus: next.status,
        recordingPath: next.path,
        recordingChecks: row.recordingChecks + 1,
        ...(next.nextAt ? { recordingNextAt: next.nextAt } : {}),
      });
      if (next.status === 'found') {
        found++;
        const ticket = await this.repo.findById(row.ticketId);
        if (ticket) {
          await this.audit.record('tickets.recording.linked', {
            target: `ticket:${row.ticketId}`,
            details: { callRowId: row.id, callId: row.callId, path: next.path },
            actorLabel: 'system',
          });
        }
      }
    }
    return found;
  }

  private async check(row: TicketCallRow): Promise<RecordingCheckResult> {
    try {
      const found = await this.pbxCalls.findCall(row.callId as string);
      const file = found?.call.recordingFile;
      if (!found || !file) return { kind: 'missing' };
      for (const candidate of recordingFileCandidates(file, found.call.start, this.recordings.monitorRoots())) {
        try {
          const rec = await this.recordings.file(candidate);
          return { kind: 'found', path: rec.path };
        } catch (err) {
          if (err instanceof NotFoundException) continue;
          throw err;
        }
      }
      return { kind: 'missing' };
    } catch (err) {
      if (err instanceof ServiceUnavailableException || (err instanceof HttpException && err.getStatus() === 503))
        return { kind: 'unavailable' };
      this.logger.warn(`recording lookup for call ${row.callId} failed: ${(err as Error).message}`);
      return { kind: 'unavailable' };
    }
  }

  /** Audio of a ticket call, for users who may see the ticket (no "took part in the call" rule here). */
  async stream(
    user: SessionUser,
    ticketId: number,
    callRowId: number,
    range: string | undefined,
    download: boolean,
  ): Promise<PreparedStream> {
    const actor = await this.presenter.actorFor(user);
    await this.tickets.visibleRow(ticketId, actor);
    const row = await this.repo.findCall(ticketId, callRowId);
    if (!row) throw new NotFoundException('Call not found');
    if (row.recordingStatus !== 'found' || !row.recordingPath)
      throw new NotFoundException('This call has no recording');
    const file = await this.recordings.file(row.recordingPath);
    const key = `${user.id}:${row.id}:${download ? 'd' : 'p'}`;
    if (download || !this.playAudit.has(key)) {
      this.playAudit.set(key, true);
      await this.audit.record(download ? 'tickets.recording.download' : 'tickets.recording.play', {
        target: `ticket:${ticketId}`,
        details: { callRowId: row.id, path: file.path },
      });
    }
    return this.recordings.prepareStream(file, range, download);
  }
}
