import type { ApiError } from '@cc/shared';
import type { z } from 'zod';

/** Error thrown for every non-2xx API response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.message ?? `HTTP ${status}`);
    this.name = 'HttpError';
  }
}

export function isHttpError(err: unknown, status?: number): err is HttpError {
  return err instanceof HttpError && (status === undefined || err.status === status);
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  /** Validate the response at runtime (recommended for anything rendered). */
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.pathname + url.search;
}

/**
 * The only way the app talks to the backend.
 * Session cookie is sent automatically (same origin, HttpOnly) — tokens never touch JS.
 */
export async function api<T = void>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });

  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) throw new HttpError(res.status, (json as ApiError | undefined) ?? null);
  return opts.schema ? opts.schema.parse(json) : (json as T);
}
