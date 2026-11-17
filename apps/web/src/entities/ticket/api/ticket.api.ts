import {
  type ApiError,
  type CallbackOutcome,
  type CategoryInput,
  type CategoryPatch,
  type CityInput,
  type CityPatch,
  type CreateTicketFields,
  type RegionInput,
  type RegionPatch,
  TicketCallPrefillSchema,
  TicketCategorySchema,
  TicketCitySchema,
  TicketContextSchema,
  type TicketDetail,
  TicketDetailSchema,
  TicketDirectoriesSchema,
  TicketDocPreviewSchema,
  TicketExecutiveSchema,
  TicketListResponseSchema,
  TicketRegionSchema,
  type TicketReportQuery,
  type TicketStatus,
  type TicketView,
  TicketReportSchema,
  TicketUnreadSchema,
} from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { HttpError, api } from '@/shared/api';

/** List filters as the UI holds them (the API schema coerces query strings). */
export interface TicketListParams {
  view: TicketView;
  status?: TicketStatus;
  regionId?: number;
  categoryId?: number;
  overdue?: boolean;
  q?: string;
}

export const ticketKeys = {
  all: ['tickets'] as const,
  lists: ['tickets', 'list'] as const,
  list: (q: TicketListParams) => ['tickets', 'list', q] as const,
  detail: (id: number) => ['tickets', 'detail', id] as const,
  context: ['tickets', 'context'] as const,
  unread: ['tickets', 'unread'] as const,
  directories: ['tickets', 'directories'] as const,
  executives: ['tickets', 'executives'] as const,
  prefill: (callId: string) => ['tickets', 'prefill', callId] as const,
  report: (q: TicketReportQuery) => ['tickets', 'report', q] as const,
};

export const ticketListQuery = (q: TicketListParams) =>
  queryOptions({
    queryKey: ticketKeys.list(q),
    queryFn: ({ signal }) =>
      api('/tickets', {
        query: { view: q.view, status: q.status, regionId: q.regionId, categoryId: q.categoryId, overdue: q.overdue ? 'true' : undefined, q: q.q },
        schema: TicketListResponseSchema,
        signal,
      }),
    staleTime: 30_000,
  });

export const ticketQuery = (id: number) =>
  queryOptions({
    queryKey: ticketKeys.detail(id),
    queryFn: ({ signal }): Promise<TicketDetail> => api(`/tickets/${id}`, { schema: TicketDetailSchema, signal }),
  });

export const ticketContextQuery = queryOptions({
  queryKey: ticketKeys.context,
  queryFn: ({ signal }) => api('/tickets/context', { schema: TicketContextSchema, signal }),
  staleTime: 5 * 60_000,
});

export const ticketUnreadQuery = queryOptions({
  queryKey: ticketKeys.unread,
  queryFn: ({ signal }) => api('/tickets/unread', { schema: TicketUnreadSchema, signal }),
  staleTime: 60_000,
});

export const ticketDirectoriesQuery = queryOptions({
  queryKey: ticketKeys.directories,
  queryFn: ({ signal }) => api('/tickets/directories', { schema: TicketDirectoriesSchema, signal }),
  staleTime: 10 * 60_000,
});

export const ticketExecutivesQuery = queryOptions({
  queryKey: ticketKeys.executives,
  queryFn: ({ signal }) => api('/tickets/directories/executives', { schema: z.array(TicketExecutiveSchema), signal }),
});

export const ticketCallPrefillQuery = (callId: string) =>
  queryOptions({
    queryKey: ticketKeys.prefill(callId),
    queryFn: ({ signal }) => api('/tickets/call-prefill', { query: { callId }, schema: TicketCallPrefillSchema, signal }),
    staleTime: 0,
    retry: false,
  });

export const ticketReportQuery = (q: TicketReportQuery) =>
  queryOptions({
    queryKey: ticketKeys.report(q),
    queryFn: ({ signal }) => api('/tickets/reports', { query: q, schema: TicketReportSchema, signal }),
  });

/** multipart/form-data request (the JSON `api()` helper can't send files). */
async function upload(path: string, fields: Record<string, string>, files: File[]): Promise<TicketDetail> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const f of files) form.append('files', f, f.name);
  const res = await fetch(`/api${path}`, { method: 'POST', body: form, credentials: 'same-origin' });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new HttpError(res.status, (json as ApiError | undefined) ?? null);
  return TicketDetailSchema.parse(json);
}

export function createTicket(input: CreateTicketFields & { files: File[] }): Promise<TicketDetail> {
  const { files, ...fields } = input;
  const plain: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') plain[k] = String(v);
  return upload('/tickets', plain, files);
}

const detail = (path: string, body: object = {}) => api(path, { method: 'POST', body, schema: TicketDetailSchema });

export const ticketActions = {
  assign: (id: number) => detail(`/tickets/${id}/assign`),
  start: (id: number) => detail(`/tickets/${id}/start`),
  resolve: (id: number, note?: string) => detail(`/tickets/${id}/resolve`, note ? { note } : {}),
  reject: (id: number, note: string) => detail(`/tickets/${id}/reject`, { note }),
  forward: (id: number, regionId: number, note?: string) => detail(`/tickets/${id}/forward`, { regionId, ...(note ? { note } : {}) }),
  call: (id: number) => detail(`/tickets/${id}/callback/call`),
  outcome: (id: number, outcome: CallbackOutcome, note?: string) => detail(`/tickets/${id}/callback/outcome`, { outcome, ...(note ? { note } : {}) }),
  forceClose: (id: number, note: string) => detail(`/tickets/${id}/close`, { note }),
  remove: (id: number) => api(`/tickets/${id}`, { method: 'DELETE' }),
};

export function addTicketComment(id: number, body: string, files: File[]): Promise<TicketDetail> {
  return upload(`/tickets/${id}/comments`, { body }, files);
}

export function attachmentUrl(ticketId: number, attachmentId: number): string {
  return `/api/tickets/${ticketId}/attachments/${attachmentId}`;
}

export function recordingUrl(ticketId: number, callRowId: number, download = false): string {
  return `/api/tickets/${ticketId}/calls/${callRowId}/recording${download ? '?download=1' : ''}`;
}

export function fetchDocPreview(ticketId: number, attachmentId: number): Promise<{ html: string }> {
  return api(`/tickets/${ticketId}/attachments/${attachmentId}/preview`, { schema: TicketDocPreviewSchema });
}

/** Superuser: ticket directories. */
export const ticketDirectories = {
  createRegion: (body: RegionInput) => api('/tickets/directories/regions', { method: 'POST', body, schema: TicketRegionSchema }),
  updateRegion: (id: number, body: RegionPatch) => api(`/tickets/directories/regions/${id}`, { method: 'PATCH', body, schema: TicketRegionSchema }),
  deleteRegion: (id: number) => api(`/tickets/directories/regions/${id}`, { method: 'DELETE' }),
  createCity: (regionId: number, body: CityInput) =>
    api(`/tickets/directories/regions/${regionId}/cities`, { method: 'POST', body, schema: TicketCitySchema }),
  updateCity: (id: number, body: CityPatch) => api(`/tickets/directories/cities/${id}`, { method: 'PATCH', body, schema: TicketCitySchema }),
  deleteCity: (id: number) => api(`/tickets/directories/cities/${id}`, { method: 'DELETE' }),
  createCategory: (body: CategoryInput) => api('/tickets/directories/categories', { method: 'POST', body, schema: TicketCategorySchema }),
  updateCategory: (id: number, body: CategoryPatch) =>
    api(`/tickets/directories/categories/${id}`, { method: 'PATCH', body, schema: TicketCategorySchema }),
  deleteCategory: (id: number) => api(`/tickets/directories/categories/${id}`, { method: 'DELETE' }),
  setExecutiveRegions: (userId: number, regionIds: number[]) =>
    api(`/tickets/directories/executives/${userId}/regions`, { method: 'PUT', body: { regionIds }, schema: TicketExecutiveSchema }),
};
