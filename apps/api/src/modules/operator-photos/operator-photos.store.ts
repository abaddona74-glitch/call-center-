import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Photo bytes on disk (OPERATOR_PHOTOS_DIR: on the server `/data/operator-photos` in the `api-data` volume, so
 * photos survive deploys). Files are named by random UUIDs without extension — nothing on disk is named or typed
 * by the uploader; the API serves them with the type detected from their content.
 */
@Injectable()
export class OperatorPhotosStore implements OnModuleInit {
  private readonly logger = new Logger(OperatorPhotosStore.name);
  readonly dir: string;

  constructor(config: AppConfig) {
    this.dir = path.resolve(config.get('OPERATOR_PHOTOS_DIR'));
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  pathOf(key: string): string {
    if (!KEY.test(key)) throw new Error('Invalid photo key');
    return path.join(this.dir, key);
  }

  async save(data: Buffer): Promise<string> {
    const key = randomUUID();
    await writeFile(this.pathOf(key), data, { mode: 0o600, flag: 'wx' });
    return key;
  }

  async remove(key: string): Promise<void> {
    await unlink(this.pathOf(key)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') this.logger.warn(`could not delete photo ${key}: ${err.message}`);
    });
  }
}
