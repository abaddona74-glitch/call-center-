import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { ByteRange } from '../domain/http-range.js';
import { resolveUnderRoot } from '../domain/recording-path.js';
import type { RecordingStorage, StorageEntry, StorageEntryType, StorageStat } from './recording-storage.port.js';

function typeOf(s: { isFile(): boolean; isDirectory(): boolean }): StorageEntryType {
  if (s.isFile()) return 'file';
  if (s.isDirectory()) return 'dir';
  return 'other';
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Monitor folder on the local disk. Used by e2e tests (and usable when the API runs on the PBX host). */
export class LocalRecordingStorage implements RecordingStorage {
  readonly configured = true;

  constructor(private readonly root: string) {}

  isConnected(): boolean {
    return true;
  }

  private abs(relative: string): string {
    // resolveUnderRoot works on posix paths; the local root is absolute on this machine.
    return path.join(this.root, resolveUnderRoot('/', relative));
  }

  async list(relativeDir: string): Promise<StorageEntry[] | null> {
    const dir = this.abs(relativeDir);
    try {
      const names = await readdir(dir);
      return await Promise.all(
        names.map(async (name) => {
          const s = await lstat(path.join(dir, name));
          return { name, type: typeOf(s), size: s.size, modifiedAt: s.mtime };
        }),
      );
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async stat(relativePath: string): Promise<StorageStat | null> {
    try {
      const s = await lstat(this.abs(relativePath));
      return { type: typeOf(s), size: s.size, modifiedAt: s.mtime };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async openRead(relativePath: string, range?: ByteRange): Promise<Readable> {
    return createReadStream(this.abs(relativePath), range ? { start: range.start, end: range.end } : {});
  }
}
