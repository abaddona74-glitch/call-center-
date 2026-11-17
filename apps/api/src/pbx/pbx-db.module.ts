import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import { AppConfig } from '../config/app-config.js';
import type { PbxDB } from './pbx-db.types.js';

/**
 * Kysely<PbxDB> connected straight to the PBX MariaDB with a READ-ONLY user,
 * or `null` when PBX_DB_* is not configured (features must degrade gracefully).
 *
 * Replaces the legacy `ssh root@pbx mysql -e "<sql>"` approach: no shell, no root,
 * parameterized queries only.
 */
export const PBX_DB = Symbol('PBX_DB');
export const InjectPbxDb = () => Inject(PBX_DB);
export type PbxDb = Kysely<PbxDB> | null;

@Global()
@Module({
  providers: [
    {
      provide: PBX_DB,
      inject: [AppConfig],
      useFactory: (config: AppConfig): PbxDb => {
        const logger = new Logger('PbxDb');
        if (!config.pbxDbEnabled) {
          logger.warn('PBX_DB_* not configured — PBX history/stats endpoints will report "pbx unavailable"');
          return null;
        }
        return new Kysely<PbxDB>({
          dialect: new MysqlDialect({
            pool: createPool({
              host: config.get('PBX_DB_HOST'),
              port: config.get('PBX_DB_PORT'),
              user: config.get('PBX_DB_USER'),
              password: config.get('PBX_DB_PASSWORD'),
              database: config.get('PBX_DB_NAME'),
              connectionLimit: 5,
              connectTimeout: 5_000,
              // Keep DATETIME as text in PBX local time; convert explicitly with luxon (Asia/Tashkent).
              dateStrings: true,
              supportBigNumbers: true,
              bigNumberStrings: false,
            }),
          }),
        });
      },
    },
  ],
  exports: [PBX_DB],
})
export class PbxDbModule implements OnApplicationShutdown {
  constructor(@InjectPbxDb() private readonly pbx: PbxDb) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pbx?.destroy();
  }
}
