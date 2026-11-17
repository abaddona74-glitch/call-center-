import { useSyncExternalStore } from 'react';

/**
 * One shared 1-second clock for every live stopwatch on the page (one interval, one render wave).
 * Pauses while the tab is hidden (like the legacy timers) and catches up when it becomes visible.
 */
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  if (typeof document !== 'undefined' && document.hidden) return;
  now = Date.now();
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', tick);
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
