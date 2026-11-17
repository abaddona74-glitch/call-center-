import type { Readable } from 'node:stream';
import { Inject } from '@nestjs/common';
import type { ByteRange } from '../domain/http-range.js';

/** `other` = symlinks, devices, sockets: never listed, never opened. */
export type StorageEntryType = 'file' | 'dir' | 'other';

export interface StorageEntry {
  name: string;
  type: StorageEntryType;
  size: number;
  modifiedAt: Date | null;
}

export interface StorageStat {
  type: StorageEntryType;
  size: number;
  modifiedAt: Date | null;
}

/**
 * Read-only access to the Asterisk monitor folder. Paths are monitor-relative and already
 * validated by `normalizeRecordingPath`; implementations re-check containment and never follow symlinks.
 * Production: SFTP (read-only user, key auth). Tests: a local directory.
 */
export interface RecordingStorage {
  readonly configured: boolean;
  isConnected(): boolean;
  /** Directory entries, or null when the directory does not exist. */
  list(relativeDir: string): Promise<StorageEntry[] | null>;
  /** lstat semantics; null when missing. */
  stat(relativePath: string): Promise<StorageStat | null>;
  openRead(relativePath: string, range?: ByteRange): Promise<Readable>;
}

export const RECORDING_STORAGE = Symbol('RECORDING_STORAGE');
export const InjectRecordingStorage = () => Inject(RECORDING_STORAGE);

/** Storage not configured or not reachable → 503 for the client. */
export class StorageUnavailableError extends Error {
  constructor(message = 'Recordings storage is unavailable') {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}
