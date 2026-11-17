import type { ExportExcelQuery } from '@cc/shared';
import { HttpError } from '@/shared/api';

function fileNameFrom(disposition: string | null): string {
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '');
  if (utf) return decodeURIComponent(utf[1]);
  return /filename="([^"]+)"/i.exec(disposition ?? '')?.[1] ?? 'Call_Center_Export.xlsx';
}

/** GET /api/export/excel → browser download (session cookie, no token in the URL). */
export async function downloadExcel(q: ExportExcelQuery): Promise<void> {
  const params = new URLSearchParams({ from: q.from, to: q.to, group: q.group, lang: q.lang, scope: q.scope });
  const res = await fetch(`/api/export/excel?${params.toString()}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new HttpError(res.status, body);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameFrom(res.headers.get('content-disposition'));
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
