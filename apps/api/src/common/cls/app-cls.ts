import type { SessionUser } from '@cc/shared';
import type { ClsStore } from 'nestjs-cls';

/**
 * Per-request context kept in AsyncLocalStorage (nestjs-cls).
 * Available anywhere down the call stack — services don't need `req`:
 *
 *   constructor(private readonly cls: ClsService<AppClsStore>) {}
 *   const user = this.cls.get('user');
 */
export interface AppClsStore extends ClsStore {
  /** Set by SessionAuthGuard for authenticated requests. */
  user?: SessionUser;
  /** Hash id of the current session (never the raw token). */
  sessionId?: string;
  /** Client IP resolved through trusted proxies. */
  ip?: string;
  userAgent?: string;
}
