import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import SftpClient from 'ssh2-sftp-client';
import { AppConfig } from '../../../config/app-config.js';
import { RealtimeService } from '../../realtime/realtime.service.js';
import type { ByteRange } from '../domain/http-range.js';
import { resolveUnderRoot } from '../domain/recording-path.js';
import {
  type RecordingStorage,
  type StorageEntry,
  type StorageEntryType,
  type StorageStat,
  StorageUnavailableError,
} from './recording-storage.port.js';

interface SftpError extends Error {
  code?: string | number;
}

/** ssh2-sftp-client has lstat since v10; @types/ssh2-sftp-client (v9) does not declare it yet. */
type SftpWithLstat = SftpClient & {
  lstat(remotePath: string): Promise<{ isFile: boolean; isDirectory: boolean; size: number; modifyTime: number }>;
};

const NOT_FOUND_CODES = new Set<string | number>(['ENOENT', 'ENOTDIR', 2]);

function listType(t: string): StorageEntryType {
  if (t === '-') return 'file';
  if (t === 'd') return 'dir';
  return 'other'; // 'l' symlink and anything else
}

/** `SHA256:<base64 without padding>` of the raw host key, like `ssh-keygen -lf`. */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/**
 * Recordings over SFTP with a read-only, key-authenticated user (no root, no SSH commands).
 * One long-lived connection, reopened on demand; status changes are pushed to admins over WS.
 */
@Injectable()
export class SftpRecordingStorage implements RecordingStorage, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('RecordingsSftp');
  private client: SftpClient | null = null;
  private connecting: Promise<SftpClient> | null = null;
  private connected = false;
  private lastErrorLogAt = 0;
  private readonly root: string;

  constructor(
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {
    this.root = config.get('SFTP_MONITOR_PATH');
  }

  get configured(): boolean {
    return Boolean(this.config.get('SFTP_HOST') && this.config.get('SFTP_USER') && this.config.get('SFTP_PRIVATE_KEY_PATH'));
  }

  isConnected(): boolean {
    return this.connected;
  }

  onApplicationBootstrap(): void {
    if (!this.configured) {
      this.logger.warn('SFTP_* not configured — recordings are unavailable');
      return;
    }
    if (!this.config.get('SFTP_HOST_FINGERPRINT')) {
      if (this.config.isProduction) {
        this.logger.error('SFTP_HOST_FINGERPRINT is not set — refusing to connect to an unpinned PBX host key');
        return;
      }
      this.logger.warn('SFTP_HOST_FINGERPRINT is not set — accepting any host key (development only)');
    }
    void this.getClient().catch(() => undefined);
  }

  async onApplicationShutdown(): Promise<void> {
    const c = this.client;
    this.client = null;
    await c?.end().catch(() => undefined);
  }

  /** Keeps the link alive and reconnects in the background (legacy health check every 15 s). */
  @Interval(30_000)
  async healthCheck(): Promise<void> {
    if (!this.configured) return;
    try {
      const c = await this.getClient();
      await c.cwd();
    } catch {
      this.markDisconnected();
    }
  }

  private setConnected(value: boolean): void {
    if (this.connected === value) return;
    this.connected = value;
    this.logger.log(value ? 'SFTP connected' : 'SFTP disconnected');
    this.realtime.broadcast('recordings.status', { connected: value }, { minRole: 'admin' });
  }

  private markDisconnected(): void {
    const c = this.client;
    this.client = null;
    this.setConnected(false);
    c?.end().catch(() => undefined);
  }

  private async getClient(): Promise<SftpClient> {
    if (!this.configured) throw new StorageUnavailableError('SFTP is not configured');
    if (this.client && this.connected) return this.client;
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<SftpClient> {
    const pins = this.config.get('SFTP_HOST_FINGERPRINT');
    if (!pins && this.config.isProduction) {
      this.setConnected(false);
      throw new StorageUnavailableError('SFTP host key is not pinned (SFTP_HOST_FINGERPRINT)');
    }
    const client = new SftpClient('cc-recordings');
    try {
      const privateKey = await readFile(this.config.get('SFTP_PRIVATE_KEY_PATH') as string);
      await client.connect({
        host: this.config.get('SFTP_HOST'),
        port: this.config.get('SFTP_PORT'),
        username: this.config.get('SFTP_USER'),
        privateKey,
        readyTimeout: 10_000,
        retries: 1,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
        // A changed PBX host key fails the handshake (possible MITM) until the pin is updated.
        hostVerifier: pins ? (key: Buffer) => pins.includes(hostKeyFingerprint(key)) : undefined,
      });
    } catch (err) {
      this.setConnected(false);
      if (Date.now() - this.lastErrorLogAt > 60_000) {
        this.lastErrorLogAt = Date.now();
        this.logger.warn(`SFTP connect failed: ${(err as Error).message}`);
      }
      await client.end().catch(() => undefined);
      throw new StorageUnavailableError();
    }
    const onDown = () => {
      if (this.client === client) this.markDisconnected();
    };
    client.on('end', onDown);
    client.on('close', onDown);
    client.on('error', onDown);
    this.client = client;
    this.setConnected(true);
    return client;
  }

  /** Runs an operation; connection-level failures drop the client so the next call reconnects. */
  private async run<T>(op: (c: SftpClient) => Promise<T>): Promise<T> {
    const c = await this.getClient();
    try {
      return await op(c);
    } catch (err) {
      const code = (err as SftpError).code;
      if (code !== undefined && NOT_FOUND_CODES.has(code)) throw err;
      if (code === 'ERR_NOT_CONNECTED' || code === 'ERR_GENERIC_CLIENT' || code === 'ECONNRESET') {
        this.markDisconnected();
        throw new StorageUnavailableError();
      }
      throw err;
    }
  }

  private abs(relative: string): string {
    return resolveUnderRoot(this.root, relative);
  }

  async list(relativeDir: string): Promise<StorageEntry[] | null> {
    const dir = this.abs(relativeDir);
    try {
      const items = await this.run((c) => c.list(dir));
      return items.map((i) => ({
        name: i.name,
        type: listType(i.type),
        size: i.size,
        modifiedAt: i.modifyTime ? new Date(i.modifyTime) : null,
      }));
    } catch (err) {
      if (NOT_FOUND_CODES.has((err as SftpError).code ?? '')) return null;
      throw err;
    }
  }

  async stat(relativePath: string): Promise<StorageStat | null> {
    const target = this.abs(relativePath);
    try {
      // lstat: a symlink is reported as a symlink, never as its target.
      const s = await this.run((c) => (c as SftpWithLstat).lstat(target));
      const type: StorageEntryType = s.isFile ? 'file' : s.isDirectory ? 'dir' : 'other';
      return { type, size: s.size, modifiedAt: s.modifyTime ? new Date(s.modifyTime) : null };
    } catch (err) {
      if (NOT_FOUND_CODES.has((err as SftpError).code ?? '')) return null;
      throw err;
    }
  }

  async openRead(relativePath: string, range?: ByteRange): Promise<Readable> {
    const target = this.abs(relativePath);
    return this.run(async (c) =>
      c.createReadStream(target, range ? { start: range.start, end: range.end } : {}),
    );
  }
}
