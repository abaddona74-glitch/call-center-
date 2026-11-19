import {
  type CallRecording,
  CallRecordingSchema,
  type CreateZipJobRequest,
  type RecordingTreeResponse,
  RecordingTreeResponseSchema,
  RecordingsStatusSchema,
  type ZipJob,
  ZipJobSchema,
} from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';
import type { ApiScope } from '@/shared/lib/api-scope';

export const recordingKeys = {
  all: ['recordings'] as const,
  tree: (path: string) => ['recordings', 'tree', path] as const,
  status: ['recordings', 'status'] as const,
  call: (uniqueid: string) => ['recordings', 'call', uniqueid] as const,
};

/** Folder listing of the Asterisk monitor tree (admins). */
export const recordingTreeQuery = (path: string) =>
  queryOptions({
    queryKey: recordingKeys.tree(path),
    queryFn: ({ signal }): Promise<RecordingTreeResponse> =>
      api('/recordings/tree', { query: { path }, schema: RecordingTreeResponseSchema, signal }),
    staleTime: 10_000,
  });

export const recordingsStatusQuery = queryOptions({
  queryKey: recordingKeys.status,
  queryFn: ({ signal }) => api('/recordings/status', { schema: RecordingsStatusSchema, signal }),
  staleTime: 30_000,
});

/** The exact recording of a call (by CDR uniqueid); `overview` scope: the overview dashboard's endpoint. */
export const callRecordingQuery = (uniqueid: string, scope: ApiScope = 'default') =>
  queryOptions({
    queryKey: [...recordingKeys.call(uniqueid), scope],
    queryFn: ({ signal }): Promise<CallRecording> =>
      api(
        scope === 'overview'
          ? `/overview/calls/${encodeURIComponent(uniqueid)}/recording`
          : `/recordings/calls/${encodeURIComponent(uniqueid)}`,
        { schema: CallRecordingSchema, signal },
      ),
    staleTime: 5 * 60_000,
  });

export function recordingStreamUrl(path: string, download = false): string {
  return `/api/recordings/stream?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`;
}

export function callRecordingStreamUrl(uniqueid: string, download = false, scope: ApiScope = 'default'): string {
  const base =
    scope === 'overview'
      ? `/api/overview/calls/${encodeURIComponent(uniqueid)}/recording/stream`
      : `/api/recordings/calls/${encodeURIComponent(uniqueid)}/stream`;
  return `${base}${download ? '?download=1' : ''}`;
}

export function createZipJob(body: CreateZipJobRequest): Promise<ZipJob> {
  return api('/recordings/zip-jobs', { body, schema: ZipJobSchema });
}

export function cancelZipJob(id: string): Promise<ZipJob> {
  return api(`/recordings/zip-jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', schema: ZipJobSchema });
}

export function zipJobDownloadUrl(id: string): string {
  return `/api/recordings/zip-jobs/${encodeURIComponent(id)}/download`;
}
