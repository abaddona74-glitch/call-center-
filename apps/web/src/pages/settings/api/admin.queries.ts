import {
  AuditActionsSchema,
  AuditPageSchema,
  type LockoutSettings,
  LockoutListSchema,
  LockoutSettingsSchema,
  SessionListSchema,
  UnlockResultSchema,
} from '@cc/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

/** Audit filters as the screen keeps them (dates YYYY-MM-DD in Asia/Tashkent). */
export interface AuditFilter {
  action?: string;
  actor?: string;
  target?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/** Admin-only data of the settings screens (sessions, login protection, audit log). */
export const adminKeys = {
  sessions: ['admin', 'sessions'] as const,
  security: ['admin', 'security'] as const,
  lockouts: ['admin', 'lockouts'] as const,
  audit: (q: AuditFilter) => ['admin', 'audit', q] as const,
  auditActions: ['admin', 'audit', 'actions'] as const,
};

export const adminSessionsQuery = queryOptions({
  queryKey: adminKeys.sessions,
  queryFn: async ({ signal }) => (await api('/sessions', { schema: SessionListSchema, signal })).items,
  refetchInterval: 30_000,
});

export function revokeSession(id: string): Promise<void> {
  return api(`/sessions/${id}`, { method: 'DELETE' });
}

export const securitySettingsQuery = queryOptions({
  queryKey: adminKeys.security,
  queryFn: ({ signal }) => api('/security/settings', { schema: LockoutSettingsSchema, signal }),
});

export function saveSecuritySettings(body: LockoutSettings): Promise<LockoutSettings> {
  return api('/security/settings', { method: 'PUT', body, schema: LockoutSettingsSchema });
}

export const lockoutsQuery = queryOptions({
  queryKey: adminKeys.lockouts,
  queryFn: async ({ signal }) => (await api('/security/lockouts', { schema: LockoutListSchema, signal })).items,
  refetchInterval: 15_000,
});

export function unlock(id: number): Promise<void> {
  return api(`/security/lockouts/${id}`, { method: 'DELETE' });
}

export function unlockAll(): Promise<number> {
  return api('/security/lockouts/clear', { method: 'POST', schema: UnlockResultSchema }).then((r) => r.unlocked);
}

export const auditQuery = (q: AuditFilter) =>
  queryOptions({
    queryKey: adminKeys.audit(q),
    queryFn: ({ signal }) =>
      api('/audit', {
        query: {
          action: q.action,
          actor: q.actor,
          target: q.target,
          from: q.from,
          to: q.to,
          page: q.page,
          pageSize: q.pageSize,
        },
        schema: AuditPageSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
  });

export const auditActionsQuery = queryOptions({
  queryKey: adminKeys.auditActions,
  queryFn: async ({ signal }) => (await api('/audit/actions', { schema: AuditActionsSchema, signal })).items,
  staleTime: 60_000,
});
