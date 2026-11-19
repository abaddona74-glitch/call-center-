import type { TicketOrganization } from '@cc/shared';

/** A ticket city/district or region as the directories give it. */
interface Place {
  id: number;
  nameUz: string;
  nameRu: string;
  isActive: boolean;
}

type Kind = 'city' | 'district';

/** Apostrophes and quotes as written in Uzbek names: Qoʻqon, Qo‘qon, Qo'qon. */
const MARKS = /[ʻʼʹ'‘’`´"“”«»]/g;

/** A first or last word that only says "city" / "district" (Latin Uzbek, Cyrillic Uzbek, Russian). */
const KIND_WORDS: Readonly<Record<string, Kind>> = {
  shahri: 'city',
  shahar: 'city',
  sh: 'city',
  шаҳри: 'city',
  шахри: 'city',
  шаҳар: 'city',
  город: 'city',
  г: 'city',
  tumani: 'district',
  tuman: 'district',
  tum: 'district',
  t: 'district',
  тумани: 'district',
  туман: 'district',
  район: 'district',
};

/** "Qoʻqon shahri" → { core: "qoqon", kind: "city" }; "Chilonzor t." → { core: "chilonzor", kind: "district" }. */
function parsePlace(name: string): { core: string; kind: Kind | null } {
  const words = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(MARKS, '')
    .replace(/[.,()\-–]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let kind: Kind | null = null;
  const last = words.at(-1);
  const first = words[0];
  if (words.length > 1 && last && KIND_WORDS[last]) {
    kind = KIND_WORDS[last];
    words.pop();
  } else if (words.length > 1 && first && KIND_WORDS[first]) {
    kind = KIND_WORDS[first];
    words.shift();
  }
  return { core: words.join(' '), kind };
}

/**
 * The city/district whose name is the registry's district name, written either way ("Chilonzor tumani",
 * "Chilonzor t.", "Chilonzor"). "Qarshi shahri" and "Qarshi tumani" are different places: when the kind
 * does not settle it, there is no match rather than a guess.
 */
export function matchCity(district: string | null, cities: readonly Place[]): number | null {
  if (!district) return null;
  const want = parsePlace(district);
  if (!want.core) return null;
  let best = 0;
  let found: number[] = [];
  for (const city of cities) {
    if (!city.isActive) continue;
    let score = 0;
    for (const name of [city.nameUz, city.nameRu]) {
      const have = parsePlace(name);
      if (have.core !== want.core) continue;
      // Same kind (or neither says) > one side does not say > different kinds (no match).
      score = Math.max(score, have.kind === want.kind ? 2 : have.kind === null || want.kind === null ? 1 : 0);
    }
    if (score > best) {
      best = score;
      found = [city.id];
    } else if (score > 0 && score === best) found.push(city.id);
  }
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * Where a registry organization is, for the ticket form: its ticket region (when that region is active)
 * and the city/district its registry district names (null when none matches). Null for republic-level
 * organizations and regions no longer offered.
 */
export function organizationPlace(
  org: Pick<TicketOrganization, 'regionId' | 'district'>,
  regions: ReadonlyArray<Place & { cities: readonly Place[] }>,
): { regionId: number; cityId: number | null } | null {
  const region = regions.find((r) => r.isActive && r.id === org.regionId);
  if (!region) return null;
  return { regionId: region.id, cityId: matchCity(org.district, region.cities) };
}
