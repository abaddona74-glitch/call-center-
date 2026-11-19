import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A callback whose identity never changes and that always calls the latest `fn`. For handlers passed into memoised
 * table columns: a new handler would rebuild the columns, re-mount the cells and drop keyboard focus from a button
 * in them (e.g. when a details dialog closes and returns focus to the number that opened it).
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
