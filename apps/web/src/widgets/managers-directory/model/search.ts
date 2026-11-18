import type {
  ManagersDirectory,
  ManagersExatEntry,
  ManagersMinistryEntry,
  ManagersRegionEntry,
  ManagersTashkentEntry,
} from '@cc/shared';

/** Tabs of the directory (legacy `?tab=` values). */
export const MANAGERS_TABS = ['tashkent', 'ministry', 'regions', 'exat'] as const;
export type ManagersTab = (typeof MANAGERS_TABS)[number];

export function isManagersTab(value: unknown): value is ManagersTab {
  return typeof value === 'string' && (MANAGERS_TABS as readonly string[]).includes(value);
}

/** Legacy `handleSearch`: the query is trimmed and lower-cased. */
export function normalizeQuery(raw: string | undefined | null): string {
  return (raw ?? '').trim().toLowerCase();
}

/** Legacy phone comparison: spaces, dashes and plus signs are ignored on both sides. */
const PHONE_NOISE = /[\s\-+]/g;

export function phoneMatches(phone: string | null | undefined, query: string): boolean {
  if (!phone) return false;
  const q = query.replace(PHONE_NOISE, '');
  // A query made only of separators ("-", "+") would otherwise match every number.
  return q.length > 0 && phone.replace(PHONE_NOISE, '').includes(q);
}

function textMatches(text: string | null | undefined, query: string): boolean {
  return !!text && text.toLowerCase().includes(query);
}

export function filterTashkent(items: readonly ManagersTashkentEntry[], query: string): ManagersTashkentEntry[] {
  if (!query) return [...items];
  return items.filter(
    (it) => textMatches(it.org, query) || textMatches(it.name, query) || phoneMatches(it.phone, query),
  );
}

export function filterMinistries(items: readonly ManagersMinistryEntry[], query: string): ManagersMinistryEntry[] {
  if (!query) return [...items];
  return items.filter(
    (it) =>
      textMatches(it.name, query) || phoneMatches(it.phone, query) || it.ministries.some((m) => textMatches(m, query)),
  );
}

export function filterRegions(items: readonly ManagersRegionEntry[], query: string): ManagersRegionEntry[] {
  if (!query) return [...items];
  return items.filter(
    (it) =>
      textMatches(it.region, query) ||
      textMatches(it.lead, query) ||
      textMatches(it.head, query) ||
      // legacy searched leadPhone and offices; the other numbers shown in the row are searchable too
      [it.leadPhone, it.extraPhone, it.headPhone, ...it.offices].some((p) => phoneMatches(p, query)),
  );
}

export function filterExat(items: readonly ManagersExatEntry[], query: string): ManagersExatEntry[] {
  if (!query) return [...items];
  return items.filter(
    (it) =>
      textMatches(it.title, query) ||
      textMatches(it.org, query) ||
      textMatches(it.desc, query) ||
      phoneMatches(it.phone, query),
  );
}

export interface FilteredDirectory {
  tashkent: ManagersTashkentEntry[];
  ministries: ManagersMinistryEntry[];
  regions: ManagersRegionEntry[];
  exat: ManagersExatEntry[];
}

export function filterDirectory(data: ManagersDirectory, query: string): FilteredDirectory {
  return {
    tashkent: filterTashkent(data.tashkent, query),
    ministries: filterMinistries(data.ministries, query),
    regions: filterRegions(data.regions, query),
    exat: filterExat(data.exat, query),
  };
}

/** Number of rows the active tab shows ("Jami: N ta …"). */
export function tabCount(filtered: FilteredDirectory, tab: ManagersTab): number {
  switch (tab) {
    case 'tashkent':
      return filtered.tashkent.length;
    case 'ministry':
      return filtered.ministries.length;
    case 'regions':
      return filtered.regions.length;
    case 'exat':
      return filtered.exat.length;
  }
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Legacy `highlight()` without HTML: splits `text` into plain and matching parts
 * (case-insensitive), to be rendered as React elements.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  if (!text) return [];
  if (!query) return [{ text, match: false }];
  const parts: HighlightPart[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(escapeRegExp(query), 'gi'))) {
    const start = m.index;
    if (start > last) parts.push({ text: text.slice(last, start), match: false });
    parts.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

/** Legacy `formatDisplayPhone`: the number without the +998 country code. */
export function formatDisplayPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/^\+?998[\s-]*/, '').trim();
}

/** Legacy `renderPhonePill` link: `+998…` digits for a `tel:` URI. */
export function telHref(raw: string): string {
  const clean = raw.replace(/[^\d+]/g, '');
  return `tel:${clean.startsWith('+') ? clean : `+998${clean.replace(/^998/, '')}`}`;
}

/** Legacy font scaler: 80%–180% in 10% steps. */
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.8;
export const FONT_SCALE_STEP = 0.1;

export function nextFontScale(current: number, delta: number): number {
  return Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, Math.round((current + delta) * 10) / 10));
}
