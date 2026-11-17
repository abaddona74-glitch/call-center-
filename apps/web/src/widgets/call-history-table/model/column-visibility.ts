import { useCallback, useState } from 'react';

const STORAGE_KEY = 'cc.history.columns';

/** Columns hidden by default (no data in CDR yet). */
export const DEFAULT_HIDDEN: Record<string, boolean> = { host: false };

function load(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_HIDDEN, ...(JSON.parse(raw) as Record<string, boolean>) };
  } catch {
    /* storage unavailable or corrupt */
  }
  return { ...DEFAULT_HIDDEN };
}

/** Column visibility persisted per browser (legacy `callcenter_history_columns`). */
export function usePersistedColumnVisibility() {
  const [visibility, setVisibility] = useState<Record<string, boolean>>(load);
  const update = useCallback(
    (next: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
      setVisibility((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        } catch {
          /* ignore */
        }
        return value;
      });
    },
    [],
  );
  return [visibility, update] as const;
}
