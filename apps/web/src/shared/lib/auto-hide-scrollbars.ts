/** How long a scrollbar stays visible after the last scroll event. */
const HIDE_AFTER_MS = 900;

/**
 * Scrollbars are invisible until something scrolls (styles in app/styles/index.css).
 * CSS cannot tell that an element is scrolling, so one capture-phase listener marks the
 * scrolling element with `data-scrolling` and clears it after a short idle pause.
 * Page scroll marks <html>, since the viewport scrollbar takes its colors from the root.
 */
export function installAutoHideScrollbars(): () => void {
  const timers = new WeakMap<Element, number>();

  const onScroll = (event: Event) => {
    const el =
      event.target === document ? document.documentElement : event.target instanceof Element ? event.target : null;
    if (!el) return;

    if (!el.hasAttribute('data-scrolling')) el.setAttribute('data-scrolling', '');
    window.clearTimeout(timers.get(el));
    timers.set(
      el,
      window.setTimeout(() => {
        el.removeAttribute('data-scrolling');
        timers.delete(el);
      }, HIDE_AFTER_MS),
    );
  };

  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => document.removeEventListener('scroll', onScroll, { capture: true });
}
