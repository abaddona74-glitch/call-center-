import {
  type CreateOperatorGroup,
  type CreateUser,
  type OperatorGroup,
  OperatorGroupListSchema,
  OperatorGroupSchema,
  type PasskeyList,
  PasskeyListSchema,
  type ResetUserPassword,
  type ResetUserPasswordResult,
  ResetUserPasswordResultSchema,
  type UpdateOperatorGroup,
  type UpdateUser,
  type User,
  type UserListQuery,
  UserListSchema,
  UserSchema,
} from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

/** Users administration and operator groups (admin+). */
export const userKeys = {
  all: ['users'] as const,
  list: (q: UserListQuery) => ['users', 'list', q] as const,
  passkeys: (userId: number) => ['users', userId, 'passkeys'] as const,
  groups: ['operator-groups'] as const,
};

export const usersQuery = (q: UserListQuery = {}) =>
  queryOptions({
    queryKey: userKeys.list(q),
    queryFn: async ({ signal }) =>
      (
        await api('/users', {
          query: { search: q.search, role: q.role, active: q.active === undefined ? undefined : String(q.active) },
          schema: UserListSchema,
          signal,
        })
      ).items,
  });

export const operatorGroupsQuery = queryOptions({
  queryKey: userKeys.groups,
  queryFn: async ({ signal }) => (await api('/operator-groups', { schema: OperatorGroupListSchema, signal })).items,
});

export const userPasskeysQuery = (userId: number) =>
  queryOptions({
    queryKey: userKeys.passkeys(userId),
    queryFn: async ({ signal }): Promise<PasskeyList['items']> =>
      (await api(`/users/${userId}/passkeys`, { schema: PasskeyListSchema, signal })).items,
  });

export function createUser(body: CreateUser): Promise<User> {
  return api('/users', { body, schema: UserSchema });
}

export function updateUser(id: number, body: UpdateUser): Promise<User> {
  return api(`/users/${id}`, { method: 'PATCH', body, schema: UserSchema });
}

export function resetUserPassword(id: number, body: ResetUserPassword): Promise<ResetUserPasswordResult> {
  return api(`/users/${id}/password`, { body, schema: ResetUserPasswordResultSchema });
}

export function deleteUser(id: number): Promise<void> {
  return api(`/users/${id}`, { method: 'DELETE' });
}

export function deleteUserPasskey(userId: number, passkeyId: string): Promise<void> {
  return api(`/users/${userId}/passkeys/${encodeURIComponent(passkeyId)}`, { method: 'DELETE' });
}

export function createOperatorGroup(body: CreateOperatorGroup): Promise<OperatorGroup> {
  return api('/operator-groups', { body, schema: OperatorGroupSchema });
}

export function updateOperatorGroup(id: number, body: UpdateOperatorGroup): Promise<OperatorGroup> {
  return api(`/operator-groups/${id}`, { method: 'PATCH', body, schema: OperatorGroupSchema });
}

export function deleteOperatorGroup(id: number): Promise<void> {
  return api(`/operator-groups/${id}`, { method: 'DELETE' });
}
