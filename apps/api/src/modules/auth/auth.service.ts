import type { SessionUser } from '@cc/shared';
import { Injectable, Logger, type OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import { sql } from 'kysely';
import { AppConfig } from '../../config/app-config.js';
import { type DbHost, InjectDb } from '../../database/db.js';
import { AuditService } from '../audit/audit.service.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password-hasher.js';
import { SessionsService } from './sessions.service.js';

export interface LoginResult {
  user: SessionUser;
  token: string;
  sessionId: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectDb() private readonly txHost: DbHost,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async login(username: string, password: string, meta: { ip?: string; userAgent?: string }): Promise<LoginResult> {
    const user = await this.txHost.tx
      .selectFrom('users')
      .select(['id', 'username', 'passwordHash', 'role', 'extension', 'email', 'isActive'])
      .where(sql`lower(username)`, '=', username.trim().toLowerCase())
      .executeTakeFirst();

    // Always run scrypt, so response time doesn't reveal whether the username exists.
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.isActive) {
      await this.audit.record('auth.login.failed', { target: `username:${username.slice(0, 64)}`, actorLabel: 'anonymous' });
      throw new UnauthorizedException('Invalid username or password');
    }

    const session = await this.sessions.create(user.id, meta);
    const sessionUser: SessionUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      extension: user.extension,
      email: user.email,
    };
    await this.audit.record('auth.login', { target: `user:${user.id}`, actorLabel: user.username });
    return { user: sessionUser, ...session };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.audit.record('auth.logout');
  }

  /** First start: create the superuser from BOOTSTRAP_SUPERUSER_* if there is none. */
  async onApplicationBootstrap(): Promise<void> {
    const password = this.config.get('BOOTSTRAP_SUPERUSER_PASSWORD');
    const existing = await this.txHost.tx
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'superuser')
      .where('isActive', '=', true)
      .executeTakeFirst()
      .catch(() => undefined); // table may not exist yet if migrations are run separately
    if (existing) return;
    if (!password) {
      this.logger.warn('No superuser exists. Set BOOTSTRAP_SUPERUSER_PASSWORD (min 12 chars) and restart to create one.');
      return;
    }
    const username = this.config.get('BOOTSTRAP_SUPERUSER_USERNAME');
    await this.txHost.tx
      .insertInto('users')
      .values({ username, passwordHash: await hashPassword(password), role: 'superuser' })
      .execute();
    await this.audit.record('users.bootstrap_superuser', { target: `username:${username}`, actorLabel: 'system' });
    this.logger.warn(`Created bootstrap superuser "${username}". Remove BOOTSTRAP_SUPERUSER_PASSWORD from the environment.`);
  }
}
