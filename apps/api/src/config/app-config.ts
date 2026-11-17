import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema.js';

/**
 * Typed access to validated configuration.
 *   constructor(private readonly config: AppConfig) {}
 *   this.config.get('DATABASE_URL')
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get pbxDbEnabled(): boolean {
    return Boolean(this.get('PBX_DB_HOST') && this.get('PBX_DB_USER'));
  }

  get amiEnabled(): boolean {
    return Boolean(this.get('AMI_HOST') && this.get('AMI_USER') && this.get('AMI_PASSWORD'));
  }
}
