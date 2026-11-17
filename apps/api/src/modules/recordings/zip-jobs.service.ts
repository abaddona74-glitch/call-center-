import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, stat, statfs, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import {
  BUSINESS_TIMEZONE,
  type CreateZipJobRequest,
  type SessionUser,
  type ZipJob,
  type ZipJobStatus,
  CreateZipJobRequestSchema,
  EMPTY_RECORDING_MAX_BYTES,
} from '@cc/shared';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ZipArchive } from 'archiver';
import { DateTime } from 'luxon';
import type { z } from 'zod';
import { AppConfig } from '../../config/app-config.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { pickRecordingRow, recordingFileCandidates } from './domain/cdr-recording.js';
import { baseName, normalizeRecordingPath } from './domain/recording-path.js';
import { RecordingsRepository } from './recordings.repository.js';
import { storageCall } from './recordings.service.js';
import { InjectRecordingStorage, type RecordingStorage } from './storage/recording-storage.port.js';

type ParsedRequest = z.output<typeof CreateZipJobRequestSchema>;

interface JobItem {
  /** Candidate monitor-relative paths; the first existing regular file is used. */
  candidates: string[];
}

interface JobState {
  id: string;
  ownerId: number;
  status: ZipJobStatus;
  total: number;
  processed: number;
  added: number;
  skipped: number;
  currentFile: string | null;
  bytesWritten: number;
  zipName: string;
  createdAt: Date;
  finishedAt: Date | null;
  expiresAt: Date | null;
  error: string | null;
  items: JobItem[];
  filePath: string;
  cancelled: boolean;
  lastPushAt: number;
}

const JOB_FILE = /^zip_[A-Za-z0-9_-]{8,40}\.zip(\.part)?$/;
const MAX_ACTIVE_PER_USER = 2;
const DISK_MARGIN_BYTES = 64 * 1024 * 1024;

/** Thrown to stop a job with a message that is safe to show to the user. */
class JobError extends Error {}

/**
 * Background ZIP export of recordings (legacy zipJobService, fixed):
 * owner-only access, bounded file count and total size, free-disk check, `.part` file renamed
 * on success, temp files deleted on failure/cancel/expiry and on startup, progress over WS.
 * Jobs are in memory (single API process); a restart drops them together with their files.
 */
@Injectable()
export class ZipJobsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ZipJobsService.name);
  private readonly jobs = new Map<string, JobState>();
  private readonly queue: JobState[] = [];
  private running = 0;
  readonly dir: string;

  constructor(
    @InjectRecordingStorage() private readonly storage: RecordingStorage,
    private readonly repo: RecordingsRepository,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {
    this.dir = path.resolve(config.get('RECORDINGS_ZIP_DIR') ?? path.join(tmpdir(), 'cc-recording-zips'));
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    // Jobs do not survive a restart: remove their leftovers (only our own file names).
    for (const name of await readdir(this.dir)) {
      if (JOB_FILE.test(name)) await unlink(path.join(this.dir, name)).catch(() => undefined);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.status === 'processing' || job.status === 'queued') job.cancelled = true;
    }
  }

  private get maxFiles(): number {
    return this.config.get('RECORDINGS_ZIP_MAX_FILES');
  }

  private get maxBytes(): number {
    return this.config.get('RECORDINGS_ZIP_MAX_MB') * 1024 * 1024;
  }

  // ---------------------------------------------------------------------------
  // Public API (controller)
  // ---------------------------------------------------------------------------

  async create(request: CreateZipJobRequest | ParsedRequest, user: SessionUser): Promise<ZipJob> {
    const req = CreateZipJobRequestSchema.parse(request);
    const active = [...this.jobs.values()].filter(
      (j) => j.ownerId === user.id && (j.status === 'queued' || j.status === 'processing'),
    );
    if (active.length >= MAX_ACTIVE_PER_USER) {
      throw new HttpException('Too many ZIP exports in progress — wait for them to finish', HttpStatus.TOO_MANY_REQUESTS);
    }

    const items = await this.resolveItems(req);
    if (items.length === 0) throw new NotFoundException('No recordings found for this selection');
    if (items.length > this.maxFiles) {
      throw new BadRequestException(`Too many recordings (${items.length}); the limit is ${this.maxFiles}. Narrow the selection.`);
    }

    const id = `zip_${randomBytes(12).toString('base64url')}`;
    const now = DateTime.now().setZone(BUSINESS_TIMEZONE);
    let zipName = req.zipName ?? `recordings_${now.toFormat('yyyy-LL-dd_HH-mm')}.zip`;
    if (!zipName.toLowerCase().endsWith('.zip')) zipName += '.zip';
    const job: JobState = {
      id,
      ownerId: user.id,
      status: 'queued',
      total: items.length,
      processed: 0,
      added: 0,
      skipped: 0,
      currentFile: null,
      bytesWritten: 0,
      zipName,
      createdAt: new Date(),
      finishedAt: null,
      expiresAt: null,
      error: null,
      items,
      filePath: path.join(this.dir, `${id}.zip`),
      cancelled: false,
      lastPushAt: 0,
    };
    this.jobs.set(id, job);
    this.queue.push(job);
    await this.audit.record('recordings.zip.create', {
      target: `zip:${id}`,
      details: { source: req.source, files: items.length, ...(req.source === 'range' ? { from: req.from, to: req.to, search: req.search } : {}) },
    });
    this.pump();
    return this.view(job);
  }

  list(user: SessionUser): ZipJob[] {
    return [...this.jobs.values()]
      .filter((j) => j.ownerId === user.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((j) => this.view(j));
  }

  get(id: string, user: SessionUser): ZipJob {
    return this.view(this.owned(id, user));
  }

  async cancel(id: string, user: SessionUser): Promise<ZipJob> {
    const job = this.owned(id, user);
    if (job.status === 'queued' || job.status === 'processing') {
      job.cancelled = true;
      if (job.status === 'queued') {
        this.queue.splice(this.queue.indexOf(job), 1);
        this.finish(job, 'cancelled', null);
      }
      await this.audit.record('recordings.zip.cancel', { target: `zip:${id}` });
    }
    return this.view(job);
  }

  /** Path and metadata of a finished archive (owner only). */
  async readyFile(id: string, user: SessionUser): Promise<{ filePath: string; zipName: string; size: number }> {
    const job = this.owned(id, user);
    if (job.status !== 'ready') throw new HttpException('The archive is not ready yet', HttpStatus.CONFLICT);
    const s = await stat(job.filePath).catch(() => null);
    if (!s) throw new NotFoundException('The archive has expired');
    await this.audit.record('recordings.zip.download', {
      target: `zip:${id}`,
      details: { files: job.added, size: s.size },
    });
    return { filePath: job.filePath, zipName: job.zipName, size: s.size };
  }

  /** Expired archives and finished job records are removed. */
  @Interval(5 * 60_000)
  async sweep(): Promise<void> {
    const now = Date.now();
    const keepMs = this.config.get('RECORDINGS_ZIP_TTL_MINUTES') * 60_000;
    for (const job of this.jobs.values()) {
      const done = job.finishedAt?.getTime();
      if (done !== undefined && now - done > keepMs) {
        await unlink(job.filePath).catch(() => undefined);
        this.jobs.delete(job.id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private owned(id: string, user: SessionUser): JobState {
    const job = this.jobs.get(id);
    // Someone else's job looks exactly like a missing one.
    if (!job || job.ownerId !== user.id) throw new NotFoundException('ZIP job not found');
    return job;
  }

  private async resolveItems(req: ParsedRequest): Promise<JobItem[]> {
    const root = [this.config.get('RECORDINGS_PBX_MONITOR_PATH'), this.config.get('SFTP_MONITOR_PATH')];
    if (req.source === 'files') {
      const unique = new Set<string>();
      for (const p of req.paths) {
        unique.add(await storageCall(async () => normalizeRecordingPath(p, 'file')));
      }
      return [...unique].map((p) => ({ candidates: [p] }));
    }
    if (req.source === 'calls') {
      const items: JobItem[] = [];
      for (const uid of new Set(req.uniqueids)) {
        const row = pickRecordingRow(await this.repo.rowsForCall(uid), uid);
        if (row) items.push({ candidates: recordingFileCandidates(row.recordingfile, row.calldate, root) });
      }
      return items.filter((i) => i.candidates.length > 0);
    }
    if (req.from > req.to) throw new BadRequestException('"from" must not be after "to"');
    const rows = await this.repo.recordedCallsInRange(req.from, req.to, req.search, this.maxFiles + 1);
    return rows
      .map((r) => ({ candidates: recordingFileCandidates(r.recordingfile, r.calldate, root) }))
      .filter((i) => i.candidates.length > 0);
  }

  private view(job: JobState): ZipJob {
    const queuePosition = job.status === 'queued' ? this.queue.indexOf(job) + 1 : 0;
    // 0-10 %: checking files, 10-99 %: writing, 100 %: ready.
    let progress = 0;
    if (job.status === 'ready') progress = 100;
    else if (job.status === 'processing' && job.total > 0) {
      progress = Math.min(99, 10 + Math.floor((job.processed / job.total) * 89));
    }
    return {
      id: job.id,
      status: job.status,
      queuePosition,
      total: job.total,
      processed: job.processed,
      added: job.added,
      skipped: job.skipped,
      progress,
      currentFile: job.currentFile,
      bytesWritten: job.bytesWritten,
      zipName: job.zipName,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      expiresAt: job.expiresAt?.toISOString() ?? null,
      error: job.error,
    };
  }

  private push(job: JobState, force = false): void {
    const now = Date.now();
    if (!force && now - job.lastPushAt < 400) return;
    job.lastPushAt = now;
    this.realtime.broadcast('recordings.zipJob', this.view(job), { userIds: [job.ownerId] });
  }

  private pump(): void {
    const limit = this.config.get('RECORDINGS_ZIP_CONCURRENCY');
    while (this.running < limit && this.queue.length > 0) {
      const job = this.queue.shift() as JobState;
      this.running++;
      job.status = 'processing';
      this.push(job, true);
      void this.run(job).finally(() => {
        this.running--;
        this.pump();
      });
    }
    for (const queued of this.queue) this.push(queued, true);
  }

  private finish(job: JobState, status: ZipJobStatus, error: string | null): void {
    job.status = status;
    job.error = error;
    job.currentFile = null;
    job.finishedAt = new Date();
    if (status === 'ready') {
      job.expiresAt = new Date(Date.now() + this.config.get('RECORDINGS_ZIP_TTL_MINUTES') * 60_000);
    }
    job.items = [];
    this.push(job, true);
  }

  private async run(job: JobState): Promise<void> {
    const part = `${job.filePath}.part`;
    try {
      // Phase 1: find the files and check the limits before writing anything.
      const files: Array<{ path: string; size: number; modifiedAt: Date | null }> = [];
      let totalBytes = 0;
      for (const item of job.items) {
        if (job.cancelled) throw new JobError('cancelled');
        let found = false;
        for (const candidate of item.candidates) {
          const s = await storageCall(() => this.storage.stat(candidate));
          if (s?.type === 'file' && s.size > EMPTY_RECORDING_MAX_BYTES) {
            files.push({ path: candidate, size: s.size, modifiedAt: s.modifiedAt });
            totalBytes += s.size;
            found = true;
            break;
          }
        }
        if (!found) job.skipped++;
        if (totalBytes > this.maxBytes) {
          throw new JobError(`The selection is larger than ${this.config.get('RECORDINGS_ZIP_MAX_MB')} MB. Narrow it down.`);
        }
      }
      if (files.length === 0) throw new JobError('None of the selected calls has a playable recording');

      const fsStat = await statfs(this.dir);
      if (fsStat.bavail * fsStat.bsize < totalBytes + DISK_MARGIN_BYTES) {
        this.logger.error(`Not enough disk space in ${this.dir} for ZIP ${job.id} (${totalBytes} bytes)`);
        throw new JobError('Not enough free disk space on the server');
      }

      // Phase 2: write the archive. WAV is already PCM: store, don't deflate.
      const archive = new ZipArchive({ store: true });
      const out = createWriteStream(part, { mode: 0o600 });
      archive.pipe(out);
      // A failing archive must also unblock the per-file wait below.
      const archiveFailed = new Promise<never>((_, reject) => archive.on('error', reject));
      archiveFailed.catch(() => undefined);
      archive.on('warning', (err) => this.logger.warn(`zip ${job.id}: ${err.message}`));

      const used = new Set<string>();
      try {
        for (const file of files) {
          if (job.cancelled) throw new JobError('cancelled');
          job.currentFile = baseName(file.path);
          const entry = uniqueEntryName(job.currentFile, used);
          const source = await storageCall(() => this.storage.openRead(file.path));
          archive.append(source, { name: entry, date: file.modifiedAt ?? new Date() });
          await Promise.race([finished(source), archiveFailed]);
          job.added++;
          job.processed = job.added + job.skipped;
          job.bytesWritten = archive.pointer();
          this.push(job);
        }
        await Promise.race([archive.finalize(), archiveFailed]);
        await finished(out);
      } catch (err) {
        archive.abort();
        out.destroy();
        throw err;
      }
      if (job.cancelled) throw new JobError('cancelled');

      await rename(part, job.filePath);
      job.bytesWritten = (await stat(job.filePath)).size;
      job.processed = job.total;
      this.finish(job, 'ready', null);
      this.logger.log(`ZIP ${job.id} ready: ${job.added} files, ${job.bytesWritten} bytes`);
    } catch (err) {
      await unlink(part).catch(() => undefined);
      await unlink(job.filePath).catch(() => undefined);
      if (job.cancelled) {
        this.finish(job, 'cancelled', null);
      } else if (err instanceof JobError) {
        this.finish(job, 'failed', err.message);
      } else {
        this.logger.error(`ZIP ${job.id} failed: ${(err as Error).stack ?? String(err)}`);
        const msg = err instanceof HttpException ? err.message : 'The archive could not be created';
        this.finish(job, 'failed', msg);
      }
    }
  }
}

function uniqueEntryName(name: string, used: Set<string>): string {
  let candidate = name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; used.has(candidate); i++) candidate = `${stem}_${i}${ext}`;
  used.add(candidate);
  return candidate;
}
