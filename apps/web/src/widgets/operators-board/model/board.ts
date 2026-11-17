import type { LiveOperator } from '@cc/shared';
import { useState } from 'react';

/** Calls an operator handled today (legacy grandTotal = answered + outbound + transfers in). */
export const grandTotal = (op: LiveOperator) => op.today.answered + op.today.outbound + op.today.transfersIn;

/** MVP / #2…#5 by today's total (only operators with calls). */
export function ranks(ops: LiveOperator[]): Map<string, number> {
  const sorted = ops
    .filter((o) => grandTotal(o) > 0)
    .sort((a, b) => grandTotal(b) - grandTotal(a) || Number(a.extension) - Number(b.extension));
  return new Map(sorted.slice(0, 5).map((o, i) => [o.extension, i]));
}

/**
 * Predicted next operator for the queue ("fewestcalls"): a free, unpaused operator with the
 * fewest calls taken. Display hint only, like legacy.
 */
export function nextInLine(ops: LiveOperator[]): string | null {
  const free = ops.filter((o) => o.presence === 'idle' && o.queue);
  if (!free.length) return null;
  free.sort(
    (a, b) => (a.queue?.callsTaken ?? 0) - (b.queue?.callsTaken ?? 0) || Number(a.extension) - Number(b.extension),
  );
  return free[0].extension;
}

/** useState persisted in localStorage (UI preference only; storage may be unavailable). */
export function usePersistedState<T extends string>(
  key: string,
  initial: T,
  allowed: readonly T[],
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      return saved && allowed.includes(saved) ? saved : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  };
  return [value, set];
}
