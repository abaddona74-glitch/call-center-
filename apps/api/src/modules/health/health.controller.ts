import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { type Kysely, sql } from 'kysely';
import { Public } from '../../common/decorators/auth.decorators.js';
import type { DB } from '../../database/db.js';
import { KYSELY } from '../../database/database.module.js';
import { InjectPbxDb, type PbxDb } from '../../pbx/pbx-db.module.js';

type Check = 'up' | 'down' | 'disabled';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    @InjectPbxDb() private readonly pbx: PbxDb,
  ) {}

  /** Liveness/readiness for Docker and the deploy script. 503 when our own DB is down. */
  @Public()
  @SkipThrottle()
  @Get()
  async check(): Promise<{ status: 'ok'; postgres: Check; pbxDb: Check; time: string }> {
    const postgres = await this.ping(() => sql`select 1`.execute(this.db));
    const pbxDb: Check = this.pbx ? await this.ping(() => sql`select 1`.execute(this.pbx as Kysely<any>)) : 'disabled';
    if (postgres !== 'up') {
      throw new ServiceUnavailableException({ message: 'postgres is down', postgres, pbxDb });
    }
    return { status: 'ok', postgres, pbxDb, time: new Date().toISOString() };
  }

  private async ping(fn: () => Promise<unknown>): Promise<Check> {
    try {
      await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000))]);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
