import type { LiveSnapshot } from '@cc/shared';
import { type UseQueryOptions, useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext } from 'react';
import { liveSnapshotQuery } from '../api/telephony.api';

/**
 * Where the live widgets (operators board, queue, active calls) read the live state from. Default: the monitor's own
 * snapshot (`GET /live/snapshot` + `telephony.*` events). A page with another source of the same shape — the
 * situation board (`GET /situation` + `situation.telephony`) — wraps them in `<LiveSnapshotProvider>`.
 */
export interface LiveSnapshotSource {
  query: UseQueryOptions<unknown, Error, unknown, readonly unknown[]>;
  /** The live snapshot inside the source's data. */
  pick: (data: unknown) => LiveSnapshot;
}

/** A source over any query (`queryOptions(...)` with data `T`) whose data holds a live snapshot. */
export function liveSnapshotSource<T>(
  query: { queryKey: readonly unknown[] },
  pick: (data: T) => LiveSnapshot,
): LiveSnapshotSource {
  return { query, pick } as unknown as LiveSnapshotSource;
}

const MONITOR = liveSnapshotSource<LiveSnapshot>(liveSnapshotQuery, (s) => s);
const LiveSnapshotContext = createContext<LiveSnapshotSource>(MONITOR);

export function LiveSnapshotProvider({ source, children }: { source: LiveSnapshotSource; children: ReactNode }) {
  return <LiveSnapshotContext.Provider value={source}>{children}</LiveSnapshotContext.Provider>;
}

/** `useQuery({ ...liveSnapshotQuery, select })` for whichever live source the page provides. */
export function useLiveSnapshot<T>(select: (s: LiveSnapshot) => T) {
  const { query, pick } = useContext(LiveSnapshotContext);
  return useQuery({ ...query, select: (data: unknown) => select(pick(data)) });
}
