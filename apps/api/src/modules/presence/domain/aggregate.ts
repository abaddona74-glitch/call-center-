import type { OnlineUser, Role } from '@cc/shared';

export interface ConnectionInfo {
  userId: number;
  username: string;
  role: Role;
  extension: string | null;
  connectedAt: number;
  lastPingAt: number;
  tab: string | null;
  visible: boolean;
}

/** One entry per user: earliest connection, the most recently active tab, visible if any tab is. */
export function aggregateOnline(connections: ConnectionInfo[]): OnlineUser[] {
  const byUser = new Map<number, ConnectionInfo[]>();
  for (const c of connections) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
  const out: OnlineUser[] = [];
  for (const list of byUser.values()) {
    const latest = list.reduce((a, b) => (b.lastPingAt > a.lastPingAt ? b : a));
    const active = list.filter((c) => c.visible).sort((a, b) => b.lastPingAt - a.lastPingAt)[0] ?? latest;
    out.push({
      userId: latest.userId,
      username: latest.username,
      role: latest.role,
      extension: latest.extension,
      tab: active.tab,
      visible: list.some((c) => c.visible),
      connections: list.length,
      connectedAt: new Date(Math.min(...list.map((c) => c.connectedAt))).toISOString(),
      lastActiveAt: new Date(latest.lastPingAt).toISOString(),
    });
  }
  return out.sort((a, b) => Number(b.visible) - Number(a.visible) || a.username.localeCompare(b.username));
}

/** Stable change detector (ignores lastActiveAt so pings alone don't trigger broadcasts). */
export function signatureOf(list: OnlineUser[]): string {
  return list.map((u) => `${u.userId}:${u.tab ?? ''}:${u.visible ? 1 : 0}:${u.connections}`).join('|');
}
