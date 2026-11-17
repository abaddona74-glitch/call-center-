import type { LiveOperator } from '@cc/shared';

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

/**
 * Legacy board layout: talking operators first (busiest first), then "Kutmoqda (Tayyor)" —
 * waiting, ringing and paused, the predicted next operator first — then offline operators.
 */
export function groupForBoard(ops: LiveOperator[], next: string | null) {
  const byScore = (a: LiveOperator, b: LiveOperator) =>
    grandTotal(b) - grandTotal(a) || Number(a.extension) - Number(b.extension);
  return {
    talking: ops.filter((o) => o.presence === 'talking').sort(byScore),
    ready: ops
      .filter((o) => o.presence !== 'talking' && o.presence !== 'offline')
      .sort((a, b) => (a.extension === next ? -1 : b.extension === next ? 1 : byScore(a, b))),
    offline: ops.filter((o) => o.presence === 'offline').sort(byScore),
  };
}
