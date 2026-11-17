import type { Readable } from 'node:stream';
import {
  type CallRecording,
  type RecordingFile,
  type RecordingTreeResponse,
  type RecordingsStatus,
  type SessionUser,
  EMPTY_RECORDING_MAX_BYTES,
  estimateRecordingSeconds,
  hasPermission,
  recordingKind,
} from '@cc/shared';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { contentDisposition } from '../../common/http/content-disposition.js';
import { AuditService } from '../audit/audit.service.js';
import { pickRecordingRow, recordingFileCandidates, rowInvolvesExtension } from './domain/cdr-recording.js';
import { type RangeResult, parseRangeHeader } from './domain/http-range.js';
import {
  InvalidRecordingPathError,
  audioContentType,
  baseName,
  isAudioFileName,
  normalizeRecordingPath,
} from './domain/recording-path.js';
import { RecordingsRepository } from './recordings.repository.js';
import {
  InjectRecordingStorage,
  type RecordingStorage,
  type StorageStat,
  StorageUnavailableError,
} from './storage/recording-storage.port.js';
import { AppConfig } from '../../config/app-config.js';

export interface PreparedStream {
  status: 200 | 206;
  headers: Record<string, string>;
  stream: Readable;
}

/** Translates storage/path errors into HTTP errors (400 / 503). */
export async function storageCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpException) throw err;
    if (err instanceof InvalidRecordingPathError) throw new BadRequestException(err.message);
    if (err instanceof StorageUnavailableError) throw new ServiceUnavailableException(err.message);
    throw err;
  }
}

function toFile(path: string, stat: StorageStat): RecordingFile {
  const name = baseName(path);
  return {
    name,
    path,
    size: stat.size,
    durationSec: estimateRecordingSeconds(stat.size),
    modifiedAt: stat.modifiedAt?.toISOString() ?? null,
    kind: recordingKind(name, stat.size),
  };
}

/**
 * Recordings browser, streaming and "recording of a call".
 * Access: admins browse everything; operators may only fetch recordings of calls they took part in.
 * Every download is audited; plays are audited once per user and file every 10 minutes
 * (an <audio> element issues many Range requests per play).
 */
@Injectable()
export class RecordingsService {
  private readonly playAudit = new LRUCache<string, true>({ max: 10_000, ttl: 10 * 60_000 });

  constructor(
    @InjectRecordingStorage() private readonly storage: RecordingStorage,
    private readonly repo: RecordingsRepository,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  /** Absolute prefixes of the monitor folder: as Asterisk writes them into the CDR, and as the SFTP user sees it. */
  monitorRoots(): string[] {
    return [this.config.get('RECORDINGS_PBX_MONITOR_PATH'), this.config.get('SFTP_MONITOR_PATH')];
  }

  status(): RecordingsStatus {
    return { configured: this.storage.configured, connected: this.storage.isConnected() };
  }

  async tree(dirInput: string): Promise<RecordingTreeResponse> {
    return storageCall(async () => {
      const dir = normalizeRecordingPath(dirInput, 'dir');
      const entries = await this.storage.list(dir);
      if (!entries) throw new NotFoundException('Folder not found');
      const join = (name: string) => (dir ? `${dir}/${name}` : name);
      const safe = entries.filter((e) => /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(e.name));
      return {
        path: dir,
        directories: safe
          .filter((e) => e.type === 'dir')
          .map((e) => ({ name: e.name, path: join(e.name), modifiedAt: e.modifiedAt?.toISOString() ?? null }))
          .sort((a, b) => b.name.localeCompare(a.name)),
        files: safe
          .filter((e) => e.type === 'file' && isAudioFileName(e.name))
          .map((e) => toFile(join(e.name), e))
          .sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '') || b.name.localeCompare(a.name)),
      };
    });
  }

  /** A regular audio file inside the monitor folder (symlinks and other types are "not found"). */
  async file(pathInput: string): Promise<RecordingFile> {
    return storageCall(async () => {
      const path = normalizeRecordingPath(pathInput, 'file');
      const stat = await this.storage.stat(path);
      if (!stat || stat.type !== 'file') throw new NotFoundException('Recording not found');
      return toFile(path, stat);
    });
  }

  /** The recording of one call, found by its exact CDR `recordingfile`. */
  async forCall(uniqueid: string, user: SessionUser): Promise<CallRecording> {
    const rows = await this.repo.rowsForCall(uniqueid);
    if (rows.length === 0) throw new NotFoundException('Call not found');

    if (!hasPermission(user, 'recordings.listen')) {
      const ext = user.extension;
      if (!ext || !rows.some((r) => rowInvolvesExtension(r, ext))) {
        await this.audit.record('recordings.denied', { target: `call:${uniqueid}` });
        throw new ForbiddenException('You can only listen to calls you took part in');
      }
    }

    const row = pickRecordingRow(rows, uniqueid);
    if (!row) throw new NotFoundException('This call has no recording');
    const candidates = recordingFileCandidates(row.recordingfile, row.calldate, this.monitorRoots());
    return storageCall(async () => {
      for (const candidate of candidates) {
        const stat = await this.storage.stat(candidate);
        if (stat?.type === 'file') return { uniqueid, calldate: row.calldate || null, file: toFile(candidate, stat) };
      }
      throw new NotFoundException('Recording file not found on the PBX');
    });
  }

  /** Opens the file for an HTTP response (Range-aware). */
  async prepareStream(file: RecordingFile, rangeHeader: string | undefined, download: boolean): Promise<PreparedStream> {
    if (file.size <= EMPTY_RECORDING_MAX_BYTES) {
      throw new UnprocessableEntityException('The recording is empty (no conversation)');
    }
    const range: RangeResult = parseRangeHeader(rangeHeader, file.size);
    if (range.kind === 'unsatisfiable') {
      throw new HttpException(
        { message: 'Requested range not satisfiable', contentRange: `bytes */${file.size}` },
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
    }
    const headers: Record<string, string> = {
      'Content-Type': audioContentType(file.name),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-cache',
      'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', file.name),
    };
    return storageCall(async () => {
      if (range.kind === 'partial') {
        const { start, end } = range.range;
        headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
        headers['Content-Length'] = String(end - start + 1);
        return { status: 206, headers, stream: await this.storage.openRead(file.path, range.range) };
      }
      headers['Content-Length'] = String(file.size);
      return { status: 200, headers, stream: await this.storage.openRead(file.path) };
    });
  }

  async auditAccess(user: SessionUser, file: RecordingFile, download: boolean, callId?: string): Promise<void> {
    const target = callId ? `call:${callId}` : `recording:${file.path}`;
    const details = { path: file.path, size: file.size };
    if (download) {
      await this.audit.record('recordings.download', { target, details });
      return;
    }
    const key = `${user.id}:${file.path}`;
    if (this.playAudit.has(key)) return;
    this.playAudit.set(key, true);
    await this.audit.record('recordings.play', { target, details });
  }
}
