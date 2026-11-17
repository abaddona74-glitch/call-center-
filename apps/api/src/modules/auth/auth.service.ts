import type { SessionUser } from '@cc/shared';
import {
  BadRequestException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { type DbHost, InjectDb } from '../../database/db.js';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUserRow, AuthRepository } from './auth.repository.js';
import { buildSessionUser } from './domain/session-user.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password-hasher.js';
import { SessionsService } from './sessions.service.js';

export interface LoginResult {
  user: SessionUser;
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectDb() private readonly txHost: DbHost,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly repo: AuthRepository,
    private readonly throttle: LoginThrottleService,
  ) {}

  async login(username: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const ip = meta.ip ?? 'unknown';
    const user = await this.repo.findByUsername(username);
    // Throws 429 while this username/IP is locked or slowed down.
    await this.throttle.assertAllowed(username, ip, { skipUserDelay: Boolean(user && user.lastLoginIp === ip) });

    // Always run scrypt, so response time doesn't reveal whether the username exists.
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.isActive) {
      const remaining = await this.throttle.registerFailure(username, ip);
      await this.audit.record('auth.login.failed', {
        target: `username:${username.slice(0, 64)}`,
        actorLabel: 'anonymous',
      });
      // The UI shows "attempts left" like legacy; the count is per username+IP, so it reveals nothing.
      throw new UnauthorizedException(`Invalid username or password. Attempts left: ${remaining}`);
    }

    await this.throttle.registerSuccess(username, ip);
    return this.startSession(user, meta);
  }

  /** Open a session for an already authenticated user (password or passkey). */
  async startSession(user: AuthUserRow, meta: RequestMeta, passkeyId?: string): Promise<LoginResult> {
    const session = await this.sessions.create(user.id, { ...meta, passkeyId });
    await this.repo.markLogin(user.id, meta.ip ?? null);
    await this.audit.record(passkeyId ? 'auth.login.passkey' : 'auth.login', {
      target: `user:${user.id}`,
      actorLabel: user.username,
      ...(passkeyId ? { details: { passkeyId } } : {}),
    });
    return { user: buildSessionUser(user), ...session };
  }

  /**
   * Re-check the current password of a logged-in user (password change, passkey registration,
   * email binding). Wrong answers count towards the same lockout as logins.
   */
  async verifyCurrentPassword(userId: number, password: string, ip: string | undefined): Promise<AuthUserRow> {
    const user = await this.repo.findById(userId);
    if (!user) throw new UnauthorizedException('Authentication required');
    const addr = ip ?? 'unknown';
    await this.throttle.assertAllowed(user.username, addr, { skipUserDelay: true });
    if (!(await verifyPassword(password, user.passwordHash))) {
      await this.throttle.registerFailure(user.username, addr);
      await this.audit.record('auth.reauth.failed', { target: `user:${user.id}` });
      throw new BadRequestException('Current password is incorrect');
    }
    return user;
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
      this.logger.warn(
        'No superuser exists. Set BOOTSTRAP_SUPERUSER_PASSWORD (min 12 chars) and restart to create one.',
      );
      return;
    }
    const username = this.config.get('BOOTSTRAP_SUPERUSER_USERNAME');
    await this.txHost.tx
      .insertInto('users')
      .values({ username, passwordHash: await hashPassword(password), role: 'superuser' })
      .execute();
    await this.audit.record('users.bootstrap_superuser', { target: `username:${username}`, actorLabel: 'system' });
    this.logger.warn(
      `Created bootstrap superuser "${username}". Remove BOOTSTRAP_SUPERUSER_PASSWORD from the environment.`,
    );
  }
}
