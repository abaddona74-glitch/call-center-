/**
 * Legacy operator rating (dashboard.js generateStarRatingHtml / renderTabOperatorCard):
 * stars by today's total — 1–9: 1★, 10–19: 2★, 20–29: 3★, 30–39: 4★, 40+: 5★ — and medals for the
 * top three (diamond, gold, silver). Kept by the owner's decision (DECISIONS.md "рейтинг операторов").
 */
const STEPS = [1, 10, 20, 30, 40] as const;

export interface Rating {
  stars: number;
  /** Calls still needed for the next star; 0 at the maximum. */
  toNext: number;
}

export function ratingOf(total: number): Rating {
  const stars = STEPS.filter((s) => total >= s).length;
  const next = STEPS[stars];
  return { stars, toNext: next === undefined ? 0 : next - total };
}

export type Medal = 'diamond' | 'gold' | 'silver';

/** Top three operators by total (only those with calls). */
export function medals(totals: Array<{ extension: string; total: number }>): Map<string, Medal> {
  const order: Medal[] = ['diamond', 'gold', 'silver'];
  return new Map(
    totals
      .filter((t) => t.total > 0)
      .sort((a, b) => b.total - a.total || Number(a.extension) - Number(b.extension))
      .slice(0, 3)
      .map((t, i) => [t.extension, order[i]]),
  );
}
