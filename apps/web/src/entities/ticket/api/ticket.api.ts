import {
  type ApiError,
  type TicketContext,
  TicketContextSchema,
  type TicketDetail,
  TicketDetailSchema,
  TicketDocPreviewSchema,
  type TicketFilter,
  type TicketListResponse,
  TicketListResponseSchema,
  type TicketTransition,
  TicketCleanupResponseSchema,
  type UpdateTicketRequest,
} from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { HttpError, api } from '@/shared/api';

export const ticketKeys = {
  all: ['tickets'] as const,
  lists: ['tickets', 'list'] as const,
  list: (filter: TicketFilter) => ['tickets', 'list', filter] as const,
  detail: (id: number) => ['tickets', 'detail', id] as const,
  context: ['tickets', 'context'] as const,
};

export const ticketListQuery = (filter: TicketFilter) =>
  queryOptions({
    queryKey: ticketKeys.list(filter),
    queryFn: ({ signal }): Promise<TicketListResponse> =>
      api('/tickets', { query: { filter }, schema: TicketListResponseSchema, signal }),
    staleTime: 30_000,
  });

export const ticketQuery = (id: number) =>
  queryOptions({
    queryKey: ticketKeys.detail(id),
    queryFn: ({ signal }): Promise<TicketDetail> => api(`/tickets/${id}`, { schema: TicketDetailSchema, signal }),
  });

export const ticketContextQuery = queryOptions({
  queryKey: ticketKeys.context,
  queryFn: ({ signal }): Promise<TicketContext> => api('/tickets/context', { schema: TicketContextSchema, signal }),
  staleTime: 5 * 60_000,
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

export function createTicket(input: { body: string; customerPhone: string; isUrgent: boolean; files: File[] }): Promise<TicketDetail> {
  return upload(
    '/tickets',
    { body: input.body, customerPhone: input.customerPhone, isUrgent: String(input.isUrgent), targetUserId: 'all' },
    input.files,
  );
}

export function updateTicket(id: number, body: UpdateTicketRequest): Promise<TicketDetail> {
  return api(`/tickets/${id}`, { method: 'PATCH', body, schema: TicketDetailSchema });
}

export function transitionTicket(id: number, transition: TicketTransition, reason?: string): Promise<TicketDetail> {
  return api(`/tickets/${id}/${transition}`, {
    method: 'POST',
    body: transition === 'reject' ? { reason } : {},
    schema: TicketDetailSchema,
  });
}

export function addTicketComment(id: number, body: string, files: File[]): Promise<TicketDetail> {
  return upload(`/tickets/${id}/comments`, { body }, files);
}

export function deleteTicket(id: number): Promise<void> {
  return api(`/tickets/${id}`, { method: 'DELETE' });
}

export function cleanupTickets(): Promise<{ removed: number }> {
  return api('/tickets/cleanup', { method: 'POST', schema: TicketCleanupResponseSchema });
}

export function attachmentUrl(ticketId: number, attachmentId: number): string {
  return `/api/tickets/${ticketId}/attachments/${attachmentId}`;
}

export function fetchDocPreview(ticketId: number, attachmentId: number): Promise<{ html: string }> {
  return api(`/tickets/${ticketId}/attachments/${attachmentId}/preview`, { schema: TicketDocPreviewSchema });
}
