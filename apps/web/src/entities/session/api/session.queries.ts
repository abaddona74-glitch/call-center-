import { type LoginRequest, type MeResponse, MeResponseSchema } from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, isHttpError } from '@/shared/api';

export const sessionKeys = {
  me: ['session', 'me'] as const,
};

/** Current user, or `null` when not logged in (401 is not an error here). */
export const sessionQuery = queryOptions({
  queryKey: sessionKeys.me,
  queryFn: async ({ signal }): Promise<MeResponse['user'] | null> => {
    try {
      const res = await api('/auth/me', { schema: MeResponseSchema, signal });
      return res.user;
    } catch (err) {
      if (isHttpError(err, 401)) return null;
      throw err;
    }
  },
  staleTime: 60_000,
});

export function login(body: LoginRequest): Promise<MeResponse> {
  return api('/auth/login', { body, schema: MeResponseSchema });
}

export function logout(): Promise<void> {
  return api('/auth/logout', { method: 'POST' });
}
