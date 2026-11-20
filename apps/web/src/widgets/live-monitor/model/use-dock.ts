import { useEffect, useRef, useState } from 'react';
import { usePersistedState } from '@/shared/lib/use-persisted-state';

const STATES = ['open', 'collapsed'] as const;
/** Length of the slide; keep in sync with `duration-320` in LiveMonitor and the app shell. */
const SLIDE_MS = 320;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export type DockMotion = 'enter' | 'exit';

/**
 * Open / collapsed state of the "Jonli Monitor" dock (remembered per browser, shared by every page that has
 * it), with the slide: on collapse the panel stays mounted while it slides out and unmounts afterwards; on
 * expand it slides in. Pass `motion` to <LiveMonitor>. Reduced motion: no slide.
 */
export function useLiveMonitorDock() {
  const [state, setState] = usePersistedState('cc_sidebar_collapsed', 'open', STATES);
  const [motion, setMotion] = useState<DockMotion | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const after = (fn: () => void) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, SLIDE_MS);
  };
  const collapse = () => {
    if (reducedMotion()) return setState('collapsed');
    setMotion('exit');
    after(() => {
      setState('collapsed');
      setMotion(undefined);
    });
  };
  const expand = () => {
    setState('open');
    if (reducedMotion()) return;
    setMotion('enter');
    after(() => setMotion(undefined));
  };

  return { open: state === 'open', motion, collapse, expand };
}
