import { type RefObject, useLayoutEffect, useRef } from 'react';

/**
 * FLIP re-order animation (legacy operator grid): when cards change places, each card starts at its
 * old position and slides to the new one. Children are matched by `data-flip-id`.
 */
export function useFlip(container: RefObject<HTMLElement | null>, signature: string): void {
  const last = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const items = [...root.querySelectorAll<HTMLElement>('[data-flip-id]')];
    const next = new Map<string, DOMRect>();
    for (const el of items) {
      const id = el.dataset.flipId!;
      const rect = el.getBoundingClientRect();
      next.set(id, rect);
      const prev = last.current.get(id);
      if (reduce || !prev) continue;
      const dx = prev.left - rect.left;
      const dy = prev.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
        duration: 420,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      });
    }
    last.current = next;
  }, [container, signature]);
}
