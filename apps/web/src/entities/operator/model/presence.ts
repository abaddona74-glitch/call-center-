import type { OperatorPresence } from '@cc/shared';

/** Legacy card state classes: wait / ring / talk / pause / offline (legacy/public/css/style.css). */
export const PRESENCE_CLASS: Record<OperatorPresence, 'wait' | 'ring' | 'talk' | 'pause' | 'offline'> = {
  idle: 'wait',
  ringing: 'ring',
  talking: 'talk',
  paused: 'pause',
  offline: 'offline',
};

/** Accent color of each state (card top bar, status text). */
export const PRESENCE_COLOR: Record<OperatorPresence, string> = {
  idle: '#ffb547',
  ringing: '#ec4899',
  talking: '#3ea6ff',
  paused: '#f59e0b',
  offline: '#ef4444',
};

/** Board order like legacy: ringing, waiting, talking, paused, offline, then extension. */
const ORDER: Record<OperatorPresence, number> = { ringing: 0, idle: 1, talking: 2, paused: 3, offline: 4 };

export function compareForBoard(
  a: { presence: OperatorPresence; extension: string },
  b: { presence: OperatorPresence; extension: string },
): number {
  return ORDER[a.presence] - ORDER[b.presence] || Number(a.extension) - Number(b.extension);
}
