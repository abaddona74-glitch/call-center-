import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BlockList, isIPv4 } from 'node:net';
import type { AgentEventType } from '@cc/shared';

/** An agent that has not sent a heartbeat for this long is offline (legacy: 38 s). */
export const AGENT_OFFLINE_AFTER_MS = 38_000;

const KEY_PREFIX = 'cca_';

/** New per-device API key: shown once to the admin, only its sha256 is stored. */
export function generateAgentKey(): string {
  return KEY_PREFIX + randomBytes(32).toString('base64url');
}

export function hashAgentKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Visible part of a key so admins can tell devices apart. */
export function agentKeyPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX.length + 6);
}

/** Cheap shape check before hashing/looking up a presented key. */
export function looksLikeAgentKey(key: unknown): key is string {
  return typeof key === 'string' && key.length >= 20 && key.length <= 100 && /^[A-Za-z0-9_-]+$/.test(key);
}

export function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** True when `ip` (IPv4 or IPv4-mapped IPv6) is inside one of the CIDRs. */
export function ipInCidrs(ip: string | undefined | null, cidrs: readonly string[]): boolean {
  if (!ip) return false;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (!isIPv4(v4)) return false;
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [net, bits] = cidr.split('/');
    const prefix = Number.parseInt(bits, 10);
    if (isIPv4(net) && prefix >= 0 && prefix <= 32) list.addSubnet(net, prefix, 'ipv4');
  }
  return list.check(v4, 'ipv4');
}

const EVENT_TYPES: Record<string, AgentEventType> = {
  RINGING: 'RINGING',
  ANSWERED: 'ANSWERED',
  ENDED: 'ENDED',
  MISSED: 'MISSED',
  DIALLED: 'DIALLED',
  DIALED: 'DIALLED',
  OUTBOUND: 'OUTBOUND',
  INCOMING: 'INCOMING',
  REJECT: 'REJECT',
  REJECTED: 'REJECT',
  INFO: 'INFO',
  // numeric codes seen in legacy data
  '1': 'DIALLED',
  '2': 'ANSWERED',
};

/** Agent event type (already upper-cased and cleaned) → stored enum; anything else is UNKNOWN. */
export function normalizeAgentEventType(raw: string): AgentEventType {
  return EVENT_TYPES[raw] ?? 'UNKNOWN';
}

export function isAgentOnline(lastSeenAt: Date | null, now = new Date()): boolean {
  return lastSeenAt !== null && now.getTime() - lastSeenAt.getTime() <= AGENT_OFFLINE_AFTER_MS;
}

/** Compares dotted versions numerically ("1.0.10" > "1.0.9"); non-numeric parts compare as text. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    const diff = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** Sanity window for times reported by agents (clock errors, garbage). */
export function plausibleAgentTime(at: Date | null, now = new Date()): Date | null {
  if (!at) return null;
  const t = at.getTime();
  return t > now.getTime() - 400 * 86_400_000 && t < now.getTime() + 86_400_000 ? at : null;
}
