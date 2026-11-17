import { useEffect, useRef, useState } from 'react';

/**
 * Keeps removed items for `ms` so they can play the legacy swipe-out animation.
 * Returns the current items plus the ones that just left (flagged `leaving`).
 */
export function useLeaving<T extends { id: string }>(items: T[], ms = 800): Array<T & { leaving?: boolean }> {
  const prev = useRef<Map<string, T>>(new Map());
  const [leaving, setLeaving] = useState<Map<string, T>>(new Map());

  useEffect(() => {
    const current = new Map(items.map((i) => [i.id, i]));
    const gone = [...prev.current.values()].filter((i) => !current.has(i.id));
    prev.current = current;
    if (!gone.length) return;
    setLeaving((m) => new Map([...m, ...gone.map((g) => [g.id, g] as const)]));
    const timer = setTimeout(() => {
      setLeaving((m) => {
        const next = new Map(m);
        for (const g of gone) next.delete(g.id);
        return next;
      });
    }, ms);
    return () => clearTimeout(timer);
  }, [items, ms]);

  const ids = new Set(items.map((i) => i.id));
  return [...items, ...[...leaving.values()].filter((l) => !ids.has(l.id)).map((l) => ({ ...l, leaving: true }))];
}
