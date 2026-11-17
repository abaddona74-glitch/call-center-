import type { LockoutKind, LockoutSettings } from '@cc/shared';

/**
 * Failed-login throttling rules (pure functions, no DB).
 *
 * Three counters per attempt:
 *  - `user_ip` (username + IP): hard lock after `maxAttempts` failures, for `lockoutMinutes`,
 *    doubling on every repeated lock (capped at 24 h). Locks only that address for that user,
 *    so an attacker cannot lock the real user out from the user's own computer.
 *  - `ip`: hard lock after `ipMaxAttempts` failures for any usernames (password spraying).
 *  - `user` (username, any IP): never a lockout — only a short, growing delay between attempts
 *    (max `maxUserDelaySeconds`) after `userSoftThreshold` failures, against distributed guessing.
 *    The delay is skipped from the address of the user's last successful login.
 *
 * Failures older than `failureWindowMinutes` are forgotten; the lock escalation resets after a day
 * without failures.
 */
export interface ThrottlePolicy {
  maxAttempts: number;
  lockoutMinutes: number;
  ipMaxAttempts: number;
  maxLockoutMinutes: number;
  failureWindowMinutes: number;
  userSoftThreshold: number;
  maxUserDelaySeconds: number;
}

export interface ThrottleState {
  failures: number;
  lockCount: number;
  lockedUntil: Date | null;
  firstFailureAt: Date;
  lastFailureAt: Date;
}

const DAY_MS = 86_400_000;

export function policyFromSettings(s: LockoutSettings): ThrottlePolicy {
  return {
    maxAttempts: s.maxAttempts,
    lockoutMinutes: s.lockoutMinutes,
    ipMaxAttempts: s.ipMaxAttempts,
    maxLockoutMinutes: 1440,
    failureWindowMinutes: Math.max(15, s.lockoutMinutes),
    userSoftThreshold: s.maxAttempts * 2,
    maxUserDelaySeconds: 30,
  };
}

/** Seconds until the next attempt is allowed (0 = allowed now). */
export function retryAfterSeconds(state: Pick<ThrottleState, 'lockedUntil'> | undefined | null, now: Date): number {
  if (!state?.lockedUntil) return 0;
  const ms = state.lockedUntil.getTime() - now.getTime();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/** New state after one more failed attempt. */
export function applyFailure(
  kind: LockoutKind,
  prev: ThrottleState | undefined | null,
  policy: ThrottlePolicy,
  now: Date,
): ThrottleState {
  const fresh: ThrottleState = { failures: 0, lockCount: 0, lockedUntil: null, firstFailureAt: now, lastFailureAt: now };
  let state: ThrottleState = prev ? { ...prev } : fresh;

  const sinceLast = now.getTime() - state.lastFailureAt.getTime();
  const locked = retryAfterSeconds(state, now) > 0;
  if (!locked && sinceLast > policy.failureWindowMinutes * 60_000) {
    state = { ...state, failures: 0, firstFailureAt: now, lockedUntil: null };
  }
  if (sinceLast > DAY_MS) state.lockCount = 0;

  state.failures += 1;
  state.lastFailureAt = now;

  if (kind === 'user') {
    const over = state.failures - policy.userSoftThreshold;
    if (over >= 0) {
      const delay = Math.min(2 ** over, policy.maxUserDelaySeconds);
      state.lockedUntil = new Date(now.getTime() + delay * 1000);
    }
    return state;
  }

  const threshold = kind === 'ip' ? policy.ipMaxAttempts : policy.maxAttempts;
  if (state.failures >= threshold) {
    const minutes = Math.min(policy.lockoutMinutes * 2 ** state.lockCount, policy.maxLockoutMinutes);
    state.lockedUntil = new Date(now.getTime() + minutes * 60_000);
    state.lockCount += 1;
    state.failures = 0;
    state.firstFailureAt = now;
  }
  return state;
}

/** Throttle keys of one login attempt. Usernames are case-insensitive. */
export function throttleKeys(username: string, ip: string): Record<LockoutKind, string> {
  const u = normalizeLoginName(username);
  return { user_ip: `${u}|${ip}`, ip, user: u };
}

export function normalizeLoginName(username: string): string {
  return username.trim().toLowerCase().slice(0, 64);
}
