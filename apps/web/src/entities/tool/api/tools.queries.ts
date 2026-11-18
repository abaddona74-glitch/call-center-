import { ManagersDirectorySchema, type ToolFileName, ToolsConfigSchema, UzcryptoInfoSchema } from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

export const toolKeys = {
  config: ['tools', 'config'] as const,
  uzcrypto: ['tools', 'uzcrypto'] as const,
  managers: ['tools', 'managers'] as const,
};

/** Installation-specific links (Telegram Form). */
export const toolsConfigQuery = queryOptions({
  queryKey: toolKeys.config,
  queryFn: ({ signal }) => api('/tools/config', { schema: ToolsConfigSchema, signal }),
  staleTime: 10 * 60_000,
});

/** Latest Uzcrypto version (the server caches the vendor lookup for an hour). */
export const uzcryptoQuery = queryOptions({
  queryKey: toolKeys.uzcrypto,
  queryFn: ({ signal }) => api('/tools/uzcrypto', { schema: UzcryptoInfoSchema, signal }),
  staleTime: 30 * 60_000,
  retry: false,
});

/** Responsible staff directory (legacy managers.html), served only to `tools.view`. */
export const managersQuery = queryOptions({
  queryKey: toolKeys.managers,
  queryFn: ({ signal }) => api('/tools/managers', { schema: ManagersDirectorySchema, signal }),
  staleTime: 30 * 60_000,
});

/** Same-origin download link (the session cookie authorizes it). */
export function toolFileUrl(name: ToolFileName): string {
  return `/api/tools/files/${encodeURIComponent(name)}`;
}

/** 302 to the vendor's installer (edo.ijro.uz). */
export function uzcryptoDownloadUrl(os: 'windows' | 'macos' = 'windows'): string {
  return `/api/tools/uzcrypto/download?os=${os}`;
}
