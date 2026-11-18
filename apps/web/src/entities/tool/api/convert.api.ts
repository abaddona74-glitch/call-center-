import type { ApiError, ServerConvertTarget } from '@cc/shared';
import { HttpError } from '@/shared/api';

export interface ConvertedBlob {
  blob: Blob;
  fileName: string;
}

/** File name from `Content-Disposition` (RFC 5987 `filename*` first). */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = header.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : fallback;
}

/**
 * Server half of the converter: multipart upload (the JSON `api()` helper can't send files), the
 * response is the converted file. Nothing is stored on the server.
 */
export async function convertOnServer(
  file: File,
  target: ServerConvertTarget,
  signal?: AbortSignal,
): Promise<ConvertedBlob> {
  const form = new FormData();
  form.append('target', target);
  form.append('file', file, file.name);
  const res = await fetch('/api/tools/convert', { method: 'POST', body: form, credentials: 'same-origin', signal });
  if (!res.ok) {
    const text = await res.text();
    let body: ApiError | null = null;
    try {
      body = text ? (JSON.parse(text) as ApiError) : null;
    } catch {
      body = null;
    }
    throw new HttpError(res.status, body);
  }
  const blob = await res.blob();
  return { blob, fileName: fileNameFromDisposition(res.headers.get('Content-Disposition'), `converted.${target}`) };
}
