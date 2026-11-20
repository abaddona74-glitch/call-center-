/**
 * Runs `update` (a synchronous DOM change: theme class, language re-render via flushSync …) as a short
 * crossfade of the whole page: the View Transitions API snapshots the old look and fades it into the new one,
 * so everything changes together instead of popping or fading element by element. Duration and easing are
 * in app/styles/index.css (`::view-transition-*`). Falls back to an instant change where the API is missing
 * or the user prefers reduced motion.
 */
export function withPageTransition(update: () => void): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || typeof document.startViewTransition !== 'function') {
    update();
    return;
  }
  document.startViewTransition(update);
}
