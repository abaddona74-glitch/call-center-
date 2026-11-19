import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

type Positions = Map<string, { left: number; top: number }>;

/** Where each card sits inside the grid: page scroll or the grid itself moving don't count. */
function measure(root: HTMLElement): Positions {
  const origin = root.getBoundingClientRect();
  const out: Positions = new Map();
  for (const el of root.querySelectorAll<HTMLElement>('[data-flip-id]')) {
    const rect = el.getBoundingClientRect();
    out.set(el.dataset.flipId!, { left: rect.left - origin.left, top: rect.top - origin.top });
  }
  return out;
}

/**
 * FLIP re-order animation (legacy operator grid): when cards change places, each card starts at its
 * old position and slides to the new one. Children are matched by `data-flip-id`.
 */
export function useFlip(container: RefObject<HTMLElement | null>, signature: string): void {
  const last = useRef<Positions>(new Map());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const next = measure(root);
    for (const el of root.querySelectorAll<HTMLElement>('[data-flip-id]')) {
      const id = el.dataset.flipId!;
      const now = next.get(id)!;
      const prev = last.current.get(id);
      if (reduce || !prev) continue;
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
        duration: 420,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      });
    }
    last.current = next;
  }, [container, signature]);

  // The grid got wider or narrower without a re-order (sidebar folded, window resized) and the cards
  // reflowed: re-measure, or the next re-order slides every card from where it used to be. Width
  // only — a re-order can change the height, and measuring then would catch cards mid-slide.
  useEffect(() => {
    const root = container.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    let width = root.clientWidth;
    const observer = new ResizeObserver(() => {
      if (root.clientWidth === width) return;
      width = root.clientWidth;
      last.current = measure(root);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [container]);
}
