import {
  type HangupCallRequest,
  type LiveSnapshot,
  LiveSnapshotSchema,
  type OriginateCallRequest,
  type PauseOperatorRequest,
  type TelephonyActionResult,
  TelephonyActionResultSchema,
  type TransferCallRequest,
} from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';
import { noteServerTime } from '@/shared/lib/server-clock';

export const telephonyKeys = {
  all: ['telephony'] as const,
  snapshot: ['telephony', 'snapshot'] as const,
};

/** Initial live state; afterwards `useLiveTelephonySync` keeps the cache current from WS events. */
export const liveSnapshotQuery = queryOptions({
  queryKey: telephonyKeys.snapshot,
  queryFn: async ({ signal }): Promise<LiveSnapshot> => {
    const started = Date.now();
    const data = await api('/live/snapshot', { schema: LiveSnapshotSchema, signal });
    noteServerTime(data.serverTime, started);
    return data;
  },
  // Live data comes over WebSocket; refetch only on reconnect or when the page mounts again.
  staleTime: Number.POSITIVE_INFINITY,
});

const post = <T>(path: string, body: T) =>
  api<TelephonyActionResult>(path, { body, schema: TelephonyActionResultSchema });

export const telephonyActions = {
  pause: (body: PauseOperatorRequest) => post('/telephony/pause', body),
  transfer: (body: TransferCallRequest) => post('/telephony/transfer', body),
  hangup: (body: HangupCallRequest) => post('/telephony/hangup', body),
  originate: (body: OriginateCallRequest) => post('/telephony/originate', body),
};
