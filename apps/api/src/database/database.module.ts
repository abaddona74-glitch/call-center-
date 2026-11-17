import { Global, Inject, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { AppConfig } from '../config/app-config.js';
import type { DB } from './db.js';
import { createDb } from './kysely.js';
import { assertMigrationsOk, createMigrator } from './migrator.js';

/** Raw Kysely instance. Prefer `DbHost` (`txHost.tx`) in services so @Transactional() works. */
export const KYSELY = Symbol('KYSELY');
export const InjectKysely = () => Inject(KYSELY);

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      inject: [AppConfig],
      useFactory: (config: AppConfig): Kysely<DB> =>
        createDb({ connectionString: config.get('DATABASE_URL'), max: config.get('DB_POOL_MAX') }),
    },
  ],
  exports: [KYSELY],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @InjectKysely() private readonly db: Kysely<DB>,
    private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get('DB_MIGRATE_ON_START')) return;
    this.logger.log('Applying database migrations (DB_MIGRATE_ON_START=true)');
    assertMigrationsOk(await createMigrator(this.db).migrateToLatest(), (m) => this.logger.log(m));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
