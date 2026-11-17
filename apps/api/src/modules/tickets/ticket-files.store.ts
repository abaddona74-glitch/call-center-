import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Attachment bytes on disk (TICKETS_UPLOAD_DIR, a volume outside any web root).
 * Files are named by random UUIDs without extension, so nothing on disk is ever
 * named or typed by the uploader; the API serves them with the detected type.
 */
@Injectable()
export class TicketFilesStore implements OnModuleInit {
  private readonly logger = new Logger(TicketFilesStore.name);
  readonly dir: string;

  constructor(config: AppConfig) {
    this.dir = path.resolve(config.get('TICKETS_UPLOAD_DIR'));
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  pathOf(key: string): string {
    if (!KEY.test(key)) throw new Error('Invalid attachment key');
    return path.join(this.dir, key);
  }

  async save(data: Buffer): Promise<string> {
    const key = randomUUID();
    await writeFile(this.pathOf(key), data, { mode: 0o600, flag: 'wx' });
    return key;
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }

  async remove(keys: Iterable<string>): Promise<void> {
    for (const key of keys) {
      await unlink(this.pathOf(key)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') this.logger.warn(`could not delete attachment ${key}: ${err.message}`);
      });
    }
  }

  /** Deletes files that no database row references (e.g. upload saved, transaction rolled back). */
  async sweepOrphans(known: Set<string>, olderThanMs: number): Promise<number> {
    let removed = 0;
    for (const name of await readdir(this.dir)) {
      if (!KEY.test(name) || known.has(name)) continue;
      const s = await stat(path.join(this.dir, name)).catch(() => null);
      if (s && Date.now() - s.mtimeMs > olderThanMs) {
        await this.remove([name]);
        removed++;
      }
    }
    return removed;
  }
}
