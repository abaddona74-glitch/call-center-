/** Formatters of the legacy explorer/player (dashboard.js). */

export function formatDuration(seconds: number): string {
  const sec = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(sec / 3600);
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Server-side legacy `formatBytes`: 2 decimals for GB/TB, 1 for MB, 0 for KB/B. */
export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const dec = i >= 3 ? 2 : i === 2 ? 1 : 0;
  return `${Number.parseFloat((bytes / 1024 ** i).toFixed(dec))} ${units[i]}`;
}

/** Player subtitle `formatBytes(b, 1)`. */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${Number.parseFloat((bytes / 1024 ** i).toFixed(decimals))} ${units[i]}`;
}

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const RU_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const RU_MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Lang = 'uz' | 'ru' | string;

function monthName(index: number, lang: Lang): string {
  return (lang === 'ru' ? RU_MONTHS : UZ_MONTHS)[index] ?? '';
}

/** "17-Noyabr" / "17 ноября" */
function dayLabel(day: number, monthIndex: number, lang: Lang): string {
  return lang === 'ru' ? `${day} ${RU_MONTHS_GEN[monthIndex] ?? ''}` : `${day}-${UZ_MONTHS[monthIndex] ?? ''}`;
}

/** Folder card title/subtitle (legacy `getExplorerFolderMeta`). */
export function folderMeta(name: string, currentPath: string, lang: Lang): { display: string; subtitle: string } {
  const parts = currentPath ? currentPath.split('/') : [];
  if (parts.length === 0 && /^\d{4}$/.test(name)) {
    return lang === 'ru' ? { display: `${name} год`, subtitle: `Архив ${name}` } : { display: `${name}-yil`, subtitle: `${name} arxivi` };
  }
  if (parts.length === 1 && /^(0?[1-9]|1[0-2])$/.test(name)) {
    const m = Number(name) - 1;
    return { display: `${monthName(m, lang)} (${name.padStart(2, '0')})`, subtitle: `${parts[0]} • ${EN_MONTHS[m]}` };
  }
  if (parts.length === 2 && /^\d{1,2}$/.test(name) && /^\d{1,2}$/.test(parts[1])) {
    const m = Number(parts[1]) - 1;
    const d = Number(name);
    return { display: dayLabel(d, m, lang), subtitle: `${d} ${EN_MONTHS[m] ?? ''} ${parts[0]}` };
  }
  return { display: name, subtitle: '' };
}

/** Breadcrumb label of segment `idx` (legacy: year raw, "11 (Noyabr)", "17-Noyabr"). */
export function crumbLabel(parts: string[], idx: number, lang: Lang): string {
  const raw = parts[idx];
  if (idx === 1 && /^\d{1,2}$/.test(raw)) return `${raw} (${monthName(Number(raw) - 1, lang)})`;
  if (idx === 2 && /^\d{1,2}$/.test(raw) && /^\d{1,2}$/.test(parts[1])) {
    return dayLabel(Number(raw), Number(parts[1]) - 1, lang);
  }
  return raw;
}

/** "7-Noyabr, 09:05" (local time). */
export function formatExplorerDateTime(iso: string | null, lang: Lang): string {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dayLabel(d.getDate(), d.getMonth(), lang)}, ${hh}:${mi}`;
}

export function formatFullDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '';
}

export function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}
