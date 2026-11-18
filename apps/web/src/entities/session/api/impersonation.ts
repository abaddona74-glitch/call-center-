import { type MeResponse, MeResponseSchema } from '@cc/shared';
import { api } from '@/shared/api';

/** "Log in as" (superuser): the server switches the session cookie to a new, time-limited session. */
export function startImpersonation(userId: number): Promise<MeResponse> {
  return api('/auth/impersonation', { body: { userId }, schema: MeResponseSchema });
}

/** Back to the own account. Resolves to null when the superuser was signed out instead. */
export async function stopImpersonation(): Promise<MeResponse | null> {
  const res = await api<MeResponse | undefined>('/auth/impersonation', { method: 'DELETE' });
  return res ? MeResponseSchema.parse(res) : null;
}
