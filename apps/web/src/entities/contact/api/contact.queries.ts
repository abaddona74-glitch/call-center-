import {
  type Contact,
  ContactAccessSchema,
  type ContactInput,
  ContactListResponseSchema,
  ContactSchema,
  TopActiveResponseSchema,
  type TopActiveQuery,
} from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

export const contactKeys = {
  all: ['contacts'] as const,
  access: ['contacts', 'access'] as const,
  list: ['contacts', 'list'] as const,
  topActive: (q: Partial<TopActiveQuery>) => ['contacts', 'top-active', q] as const,
};

/** What the current user may do (decided by the server from the operator group). */
export const contactAccessQuery = queryOptions({
  queryKey: contactKeys.access,
  queryFn: ({ signal }) => api('/contacts/access', { schema: ContactAccessSchema, signal }),
  staleTime: 5 * 60_000,
});

/** The whole phonebook (legacy loads all contacts and filters on the client). */
export const contactsQuery = queryOptions({
  queryKey: contactKeys.list,
  queryFn: ({ signal }) => api('/contacts', { query: { pageSize: 5000 }, schema: ContactListResponseSchema, signal }),
  staleTime: 60_000,
});

export function topActiveQuery(q: Partial<TopActiveQuery> = {}) {
  return queryOptions({
    queryKey: contactKeys.topActive(q),
    queryFn: ({ signal }) =>
      api('/contacts/top-active', {
        query: q as Record<string, string | number>,
        schema: TopActiveResponseSchema,
        signal,
      }),
    staleTime: 60_000,
    retry: false,
  });
}

/** Creates or updates; when `originalPhone` differs from `input.phone` the contact is moved. */
export function saveContact(input: ContactInput, originalPhone?: string): Promise<Contact> {
  return originalPhone
    ? api(`/contacts/${encodeURIComponent(originalPhone)}`, { method: 'PUT', body: input, schema: ContactSchema })
    : api('/contacts', { body: input, schema: ContactSchema });
}

export function deleteContact(phone: string): Promise<void> {
  return api(`/contacts/${encodeURIComponent(phone)}`, { method: 'DELETE' });
}
