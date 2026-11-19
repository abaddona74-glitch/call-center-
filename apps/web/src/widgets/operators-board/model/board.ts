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
 * Operator-portal leaderboard (legacy viewer `sortedByScore`): every operator with calls today,
 * across all groups, busiest first, then longer total talk, then lower extension.
 */
export function leaderboard(ops: LiveOperator[]): Map<string, number> {
  const sorted = ops
    .filter((o) => grandTotal(o) > 0)
    .sort(
      (a, b) =>
        grandTotal(b) - grandTotal(a) ||
        b.today.talkSeconds - a.today.talkSeconds ||
        Number(a.extension) - Number(b.extension),
    );
  return new Map(sorted.map((o, i) => [o.extension, i]));
}

export type Tier = 'diamond' | 'gold' | 'silver';

/** Legacy viewer card tiers: #1 Diamond (MVP), #2 Gold, #3 and #4 Silver. */
export function tierOf(rank: number | undefined): Tier | null {
  if (rank === 0) return 'diamond';
  if (rank === 1) return 'gold';
  if (rank === 2 || rank === 3) return 'silver';
  return null;
}

/** Calls needed for 1…5 stars (legacy `generateStarRatingHtml`). */
export const STAR_THRESHOLDS = [1, 10, 20, 30, 40] as const;

/** Star level for today's total and how many calls are left to the next star (0 at the top). */
export function starLevel(total: number): { level: number; toNext: number } {
  const level = STAR_THRESHOLDS.filter((n) => total >= n).length;
  const next = STAR_THRESHOLDS[level];
  return { level, toNext: next === undefined ? 0 : next - total };
}

/** Today's post-call survey of one operator (asteriskcdrdb.operator_baho via GET /api/stats/operators). */
export interface SurveyScore {
  /** Average rating 1–5, null without ratings. */
  avg: number | null;
  count: number;
}

/**
 * "Samaradorlik" = the clients' average rating as a share of 5 (owner, 19.11): 4.6 → 92 %, 1 → 20 %.
 * null without ratings.
 */
export function surveyPercent(avg: number | null | undefined): number | null {
  if (avg === null || avg === undefined) return null;
  return Math.min(100, Math.max(0, Math.round((avg / 5) * 100)));
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
