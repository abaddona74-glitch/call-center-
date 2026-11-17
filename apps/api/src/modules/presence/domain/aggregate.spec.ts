import { describe, expect, it } from 'vitest';
import { aggregateOnline, signatureOf } from './aggregate.js';

const c = (
  userId: number,
  username: string,
  tab: string | null,
  visible: boolean,
  lastPingAt: number,
  connectedAt = 1_000,
) => ({
  userId,
  username,
  role: 'operator' as const,
  extension: '101',
  connectedAt,
  lastPingAt,
  tab,
  visible,
});

describe('aggregateOnline', () => {
  it('merges tabs of one user and prefers the visible, most recent one', () => {
    const list = aggregateOnline([
      c(1, 'op101', '/operators', false, 5_000, 500),
      c(1, 'op101', '/', true, 3_000, 2_000),
      c(2, 'admin', '/settings', false, 4_000),
    ]);
    expect(list).toEqual([
      expect.objectContaining({
        userId: 1,
        tab: '/',
        visible: true,
        connections: 2,
        connectedAt: new Date(500).toISOString(),
        lastActiveAt: new Date(5_000).toISOString(),
      }),
      expect.objectContaining({ userId: 2, tab: '/settings', visible: false, connections: 1 }),
    ]);
  });

  it('signature ignores ping times', () => {
    const a = aggregateOnline([c(1, 'op101', '/', true, 1_000)]);
    const b = aggregateOnline([c(1, 'op101', '/', true, 9_000)]);
    expect(signatureOf(a)).toBe(signatureOf(b));
    expect(signatureOf(a)).not.toBe(signatureOf(aggregateOnline([c(1, 'op101', '/operators', true, 1_000)])));
  });
});
