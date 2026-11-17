import { describe, expect, it } from 'vitest';
import {
  agentKeyPrefix,
  compareVersions,
  generateAgentKey,
  hashAgentKey,
  ipInCidrs,
  isAgentOnline,
  looksLikeAgentKey,
  normalizeAgentEventType,
  plausibleAgentTime,
  sameHash,
} from './agent-rules.js';

describe('agent keys', () => {
  it('generates distinct, well-formed keys and stores only a hash', () => {
    const a = generateAgentKey();
    const b = generateAgentKey();
    expect(a).not.toBe(b);
    expect(looksLikeAgentKey(a)).toBe(true);
    expect(hashAgentKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAgentKey(a)).not.toContain(a);
    expect(agentKeyPrefix(a)).toBe(a.slice(0, 10));
    expect(sameHash(hashAgentKey(a), hashAgentKey(a))).toBe(true);
    expect(sameHash(hashAgentKey(a), hashAgentKey(b))).toBe(false);
  });

  it.each([undefined, '', 'short', 'x'.repeat(101), 'has spaces in it but long enough', 'cca_abc\r\nX-Injected: 1'])(
    'rejects malformed key %j',
    (key) => {
      expect(looksLikeAgentKey(key)).toBe(false);
    },
  );
});

describe('ipInCidrs', () => {
  const privateNets = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
  it.each([
    ['192.168.0.17', true],
    ['::ffff:192.168.0.17', true],
    ['10.20.30.40', true],
    ['172.31.255.1', true],
    ['172.32.0.1', false],
    ['8.8.8.8', false],
    ['::1', false],
    ['', false],
    [null, false],
  ])('%s → %s', (ip, expected) => {
    expect(ipInCidrs(ip, privateNets)).toBe(expected);
  });

  it('honours narrow ranges', () => {
    expect(ipInCidrs('192.168.0.17', ['192.168.0.16/30'])).toBe(true);
    expect(ipInCidrs('192.168.0.20', ['192.168.0.16/30'])).toBe(false);
  });
});

describe('normalizeAgentEventType', () => {
  it.each([
    ['ANSWERED', 'ANSWERED'],
    ['DIALED', 'DIALLED'],
    ['1', 'DIALLED'],
    ['2', 'ANSWERED'],
    ['REJECTED', 'REJECT'],
    ['WHATEVER', 'UNKNOWN'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeAgentEventType(raw)).toBe(expected);
  });
});

describe('isAgentOnline', () => {
  const now = new Date('2026-11-17T10:00:00Z');
  it('is online within 38 seconds of the last heartbeat', () => {
    expect(isAgentOnline(new Date('2026-11-17T09:59:30Z'), now)).toBe(true);
    expect(isAgentOnline(new Date('2026-11-17T09:59:20Z'), now)).toBe(false);
    expect(isAgentOnline(null, now)).toBe(false);
  });
});

describe('compareVersions', () => {
  it.each([
    ['1.0.10', '1.0.9', 1],
    ['1.0.4', '1.0.4', 0],
    ['1.0', '1.0.0', 0],
    ['1.2.0', '1.10.0', -1],
    ['2.0.0-beta', '2.0.0-alpha', 1],
  ])('%s vs %s → %d', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe('plausibleAgentTime', () => {
  const now = new Date('2026-11-17T10:00:00Z');
  it('drops times far in the past or future', () => {
    expect(plausibleAgentTime(new Date('2026-11-17T09:00:00Z'), now)).not.toBeNull();
    expect(plausibleAgentTime(new Date('2020-01-01T00:00:00Z'), now)).toBeNull();
    expect(plausibleAgentTime(new Date('2026-11-20T00:00:00Z'), now)).toBeNull();
    expect(plausibleAgentTime(null, now)).toBeNull();
  });
});
