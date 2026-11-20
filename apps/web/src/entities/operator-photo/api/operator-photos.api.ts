import { type ApiError, type OperatorPhotosInfo, OperatorPhotosSchema } from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { HttpError, api } from '@/shared/api';

export const operatorPhotoKeys = {
  all: ['operator-photos'] as const,
};

/** Every operator (PBX directory) with its photo — the settings screen. The cards get `photoUrl` from the live board. */
export const operatorPhotosQuery = queryOptions({
  queryKey: operatorPhotoKeys.all,
  queryFn: ({ signal }) => api('/operator-photos', { schema: OperatorPhotosSchema, signal }),
  staleTime: 60_000,
});

/** Sets or replaces an operator's photo (multipart: the JSON `api()` helper can't send files). */
export async function uploadOperatorPhoto(extension: string, file: Blob, fileName: string): Promise<OperatorPhotosInfo> {
  const form = new FormData();
  form.append('file', file, fileName);
  const res = await fetch(`/api/operator-photos/${encodeURIComponent(extension)}`, {
    method: 'PUT',
    body: form,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new HttpError(res.status, (json as ApiError | undefined) ?? null);
  return OperatorPhotosSchema.parse(json);
}

export function removeOperatorPhoto(extension: string): Promise<OperatorPhotosInfo> {
  return api(`/operator-photos/${encodeURIComponent(extension)}`, { method: 'DELETE', schema: OperatorPhotosSchema });
}
