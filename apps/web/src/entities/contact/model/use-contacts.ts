import type { Contact, ContactAccess } from '@cc/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useRealtimeEvent } from '@/shared/api';
import { contactAccessQuery, contactKeys, contactsQuery } from '../api/contact.queries';

const NO_ACCESS: ContactAccess = { canView: false, canEdit: false };

export function useContactAccess(): ContactAccess {
  return useQuery(contactAccessQuery).data ?? NO_ACCESS;
}

/** Refetches contact data when the phonebook changes (`contacts.changed`). */
export function useContactsLive(): void {
  const queryClient = useQueryClient();
  useRealtimeEvent('contacts.changed', () => {
    void queryClient.invalidateQueries({ queryKey: contactKeys.list });
    void queryClient.invalidateQueries({ queryKey: ['contacts', 'top-active'] });
  });
}

function key(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length === 12 && d.startsWith('998') ? d.slice(3) : d;
}

/**
 * `(phone) => Contact | undefined` for showing saved names next to numbers.
 * Empty for users whose group may not see contacts (the server refuses the list anyway).
 */
export function useContactLookup(): (phone: string | null | undefined) => Contact | undefined {
  const { canView } = useContactAccess();
  const { data } = useQuery({ ...contactsQuery, enabled: canView });
  const map = useMemo(() => new Map((data?.items ?? []).map((c) => [key(c.phone), c])), [data]);
  return useCallback((phone) => (phone ? map.get(key(phone)) : undefined), [map]);
}
