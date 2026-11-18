/**
 * Tools zones layout (legacy viewer.js "Tools Drag & Drop Engine"): three zones, cards dragged between
 * them, the order remembered in this browser (localStorage, like legacy).
 */
export const ZONES = ['admin', 'primary', 'secondary'] as const;
export type Zone = (typeof ZONES)[number];

export const TOOL_IDS = [
  'edo_cabinet',
  'ehuquq_cabinet',
  'operator_manual',
  'systems_tree',
  'anydesk',
  'managers',
  'converter',
  'uzcrypto',
  'telegram',
  'ijro_letter',
  'uzb2026',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export type Layout = Record<Zone, ToolId[]>;

/** Legacy markup order (3CX cards and RustDesk are not moved to the new system). */
export const DEFAULT_LAYOUT: Layout = {
  admin: ['edo_cabinet', 'ehuquq_cabinet'],
  primary: ['operator_manual', 'systems_tree', 'anydesk', 'managers', 'converter'],
  secondary: ['uzcrypto', 'telegram', 'ijro_letter', 'uzb2026'],
};

export const LAYOUT_STORAGE_KEY = 'cc.tools.layout.v1';

const isToolId = (v: unknown): v is ToolId => typeof v === 'string' && (TOOL_IDS as readonly string[]).includes(v);

function defaultZoneOf(id: ToolId): Zone {
  return ZONES.find((z) => DEFAULT_LAYOUT[z].includes(id)) ?? 'secondary';
}

/**
 * Saved layout → layout: saved cards go to their saved zones in the saved order (unknown ids and
 * duplicates are dropped); cards the saved layout does not know (new ones) join their default zone.
 */
export function restoreLayout(saved: unknown): Layout {
  const out: Layout = { admin: [], primary: [], secondary: [] };
  const placed = new Set<ToolId>();
  if (saved && typeof saved === 'object') {
    for (const zone of ZONES) {
      const ids = (saved as Record<string, unknown>)[zone];
      if (!Array.isArray(ids)) continue;
      for (const id of ids) {
        if (isToolId(id) && !placed.has(id)) {
          out[zone].push(id);
          placed.add(id);
        }
      }
    }
  }
  for (const id of TOOL_IDS) if (!placed.has(id)) out[defaultZoneOf(id)].push(id);
  return out;
}

/** Move a card to `zone`, before `beforeId` (or to the end). */
export function moveTool(layout: Layout, id: ToolId, zone: Zone, beforeId: ToolId | null): Layout {
  const out: Layout = {
    admin: layout.admin.filter((x) => x !== id),
    primary: layout.primary.filter((x) => x !== id),
    secondary: layout.secondary.filter((x) => x !== id),
  };
  const at = beforeId && beforeId !== id ? out[zone].indexOf(beforeId) : -1;
  if (at >= 0) out[zone].splice(at, 0, id);
  else out[zone].push(id);
  return out;
}

export function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return restoreLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return restoreLayout(null);
  }
}

export function saveLayout(layout: Layout): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* storage unavailable: the layout lives until the page is left */
  }
}

/**
 * Legacy getToolsDragAfterElement: the card the dropped one goes before — the nearest card whose
 * centre lies after the pointer in reading order.
 */
export function dropBefore(
  cards: { id: ToolId; left: number; top: number; width: number; height: number }[],
  x: number,
  y: number,
): ToolId | null {
  let best: ToolId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of cards) {
    const cx = c.left + c.width / 2;
    const cy = c.top + c.height / 2;
    const before = y < c.top || (y <= c.top + c.height && x < cx);
    if (!before) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestDistance) {
      bestDistance = d;
      best = c.id;
    }
  }
  return best;
}
