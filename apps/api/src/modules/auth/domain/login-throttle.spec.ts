import { applyFailure, policyFromSettings, retryAfterSeconds, throttleKeys, type ThrottleState } from './login-throttle.js';

const policy = policyFromSettings({ maxAttempts: 3, lockoutMinutes: 10, ipMaxAttempts: 10 });
const t0 = new Date('2026-11-17T10:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const MIN = 60_000;

function fail(kind: 'user_ip' | 'ip' | 'user', times: number, start?: ThrottleState, stepMs = 1000) {
  let s = start;
  let now = t0;
  for (let i = 0; i < times; i++) {
    now = at(i * stepMs);
    s = applyFailure(kind, s, policy, now);
  }
  return { state: s!, now };
}

describe('login throttle', () => {
  it('locks username+IP after maxAttempts failures for lockoutMinutes', () => {
    const two = fail('user_ip', 2);
    expect(retryAfterSeconds(two.state, two.now)).toBe(0);
    const three = fail('user_ip', 3);
    expect(retryAfterSeconds(three.state, three.now)).toBe(10 * 60);
    expect(three.state.lockCount).toBe(1);
    expect(three.state.failures).toBe(0);
  });

  it('doubles the lock on every repeated lockout, capped at 24 h', () => {
    let s: ThrottleState | undefined;
    let now = t0;
    const durations: number[] = [];
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 3; i++) {
        s = applyFailure('user_ip', s, policy, now);
        now = new Date(now.getTime() + 1000);
      }
      const secs = retryAfterSeconds(s, now) + 1;
      durations.push(Math.round(secs / 60));
      now = new Date(s!.lockedUntil!.getTime() + 1000);
    }
    expect(durations.slice(0, 4)).toEqual([10, 20, 40, 80]);
    expect(Math.max(...durations)).toBe(1440);
  });

  it('forgets old failures after the window', () => {
    const { state } = fail('user_ip', 2);
    const later = at(policy.failureWindowMinutes * MIN + 5000);
    const next = applyFailure('user_ip', state, policy, later);
    expect(next.failures).toBe(1);
    expect(retryAfterSeconds(next, later)).toBe(0);
  });

  it('resets escalation after a day without failures', () => {
    const locked = fail('user_ip', 3).state;
    const nextDay = at(25 * 60 * MIN);
    const s = applyFailure('user_ip', locked, policy, nextDay);
    expect(s.lockCount).toBe(0);
  });

  it('locks an IP only after ipMaxAttempts', () => {
    const nine = fail('ip', 9);
    expect(retryAfterSeconds(nine.state, nine.now)).toBe(0);
    const ten = fail('ip', 10);
    expect(retryAfterSeconds(ten.state, ten.now)).toBe(600);
  });

  it('never locks a username out: only short delays, capped', () => {
    // 1000 failures from many addresses within the window
    const { state, now } = fail('user', 1000, undefined, 100);
    const wait = retryAfterSeconds(state, now);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(policy.maxUserDelaySeconds);
  });

  it('starts delaying a username only after the soft threshold', () => {
    const below = fail('user', policy.userSoftThreshold - 1);
    expect(retryAfterSeconds(below.state, below.now)).toBe(0);
    const at = fail('user', policy.userSoftThreshold);
    expect(retryAfterSeconds(at.state, at.now)).toBe(1);
  });

  it('builds case-insensitive keys', () => {
    expect(throttleKeys('  Admin ', '10.0.0.1')).toEqual({ user_ip: 'admin|10.0.0.1', ip: '10.0.0.1', user: 'admin' });
  });
});
