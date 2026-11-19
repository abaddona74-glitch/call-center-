#!/usr/bin/env node
/**
 * Builds the Uzbekistan regions map used by the observer dashboard
 * (src/widgets/region-map/model/uz-regions.json) from Natural Earth admin-1 (public domain).
 *
 *   curl -L -o ne_10m_admin_1.geojson \
 *     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
 *   node apps/web/scripts/build-uz-regions.mjs ne_10m_admin_1.geojson > apps/web/src/widgets/region-map/model/uz-regions.json
 *   npx prettier --write apps/web/src/widgets/region-map/model/uz-regions.json
 *
 * What it does: takes the 14 first-level units of Uzbekistan, simplifies the borders (Douglas–Peucker) so that a
 * border shared by two regions is simplified once and stays shared (no gaps or overlaps), projects them
 * (equirectangular, x scaled by cos of the middle latitude) into a 1000-unit wide SVG box and writes one SVG path
 * per region, keyed by `ticket_regions.code`, plus a label point inside each region.
 * Pure Node, no dependencies; the input is only parsed as JSON.
 */
import { readFileSync } from 'node:fs';

const NE_TO_CODE = {
  'UZ-TK': 'toshkent-shahri',
  'UZ-TO': 'toshkent-viloyati',
  'UZ-AN': 'andijon',
  'UZ-BU': 'buxoro',
  'UZ-FA': 'fargona',
  'UZ-JI': 'jizzax',
  'UZ-XO': 'xorazm',
  'UZ-NG': 'namangan',
  'UZ-NW': 'navoiy',
  'UZ-QA': 'qashqadaryo',
  'UZ-SA': 'samarqand',
  'UZ-SI': 'sirdaryo',
  'UZ-SU': 'surxondaryo',
  'UZ-QR': 'qoraqalpogiston',
};
/** Degrees. ~0.6 px at 1000 px for the whole country; small enough for the Fergana valley. */
const TOLERANCE = 0.012;
/** Rings smaller than this (deg²) are dropped (specks of exclaves invisible at this scale). */
const MIN_RING_AREA = 0.0004;
const WIDTH = 1000;

const input = process.argv[2];
if (!input) {
  console.error('usage: build-uz-regions.mjs <ne_10m_admin_1_states_provinces.geojson>');
  process.exit(1);
}
const world = JSON.parse(readFileSync(input, 'utf8'));
const features = world.features.filter((f) => f.properties?.adm0_a3 === 'UZB');
const regions = features.map((f) => {
  const code = NE_TO_CODE[f.properties.iso_3166_2];
  if (!code) throw new Error(`Unknown region ${f.properties.iso_3166_2} (${f.properties.name})`);
  const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
  // Rings without the closing point, coordinates rounded so shared vertices match exactly.
  const rings = polys.map((poly) => poly.map((ring) => ring.slice(0, -1).map(([x, y]) => [round(x, 5), round(y, 5)])));
  return { code, polys: rings };
});
if (regions.length !== 14) throw new Error(`Expected 14 regions, got ${regions.length}`);

function round(v, d) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}
const key = (p) => `${p[0]},${p[1]}`;

// --- topology: which regions own each vertex -------------------------------------------------
const owners = new Map();
for (const r of regions)
  for (const poly of r.polys)
    for (const ring of poly)
      for (const p of ring) {
        const k = key(p);
        if (!owners.has(k)) owners.set(k, new Set());
        owners.get(k).add(r.code);
      }
const ownerSig = (p) => [...owners.get(key(p))].sort().join('|');

// --- Douglas–Peucker -----------------------------------------------------------------------
function segDist(p, a, b) {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  let t = len ? ((x - x1) * dx + (y - y1) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
function dp(points) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(points[i], points[s], points[e]);
      if (d > max) [max, idx] = [d, i];
    }
    if (max > TOLERANCE && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A chain is simplified in a canonical direction and cached, so both neighbours get the same border. */
const chainCache = new Map();
function simplifyChain(chain) {
  const a = key(chain[0]);
  const b = key(chain[chain.length - 1]);
  const forward = a < b || (a === b && key(chain[1]) < key(chain[chain.length - 2]));
  const canon = forward ? chain : [...chain].reverse();
  const ck = canon.map(key).join(';');
  let out = chainCache.get(ck);
  if (!out) {
    out = dp(canon);
    chainCache.set(ck, out);
  }
  return forward ? out : [...out].reverse();
}

function simplifyRing(ring) {
  const n = ring.length;
  const sig = ring.map(ownerSig);
  const breaks = [];
  for (let i = 0; i < n; i++) {
    const prev = sig[(i - 1 + n) % n];
    const next = sig[(i + 1) % n];
    if (sig[i] !== prev || sig[i] !== next || sig[i].split('|').length >= 3) breaks.push(i);
  }
  if (breaks.length === 0) {
    // One owner set all around (an island or a ring inside one neighbour): fix the smallest vertex
    // and the one opposite to it, simplify both halves.
    let start = 0;
    for (let i = 1; i < n; i++) if (key(ring[i]) < key(ring[start])) start = i;
    breaks.push(start, (start + Math.floor(n / 2)) % n);
    breaks.sort((x, y) => x - y);
  }
  const out = [];
  for (let b = 0; b < breaks.length; b++) {
    const s = breaks[b];
    const e = breaks[(b + 1) % breaks.length];
    const chain = [];
    for (let i = s; ; i = (i + 1) % n) {
      chain.push(ring[i]);
      if (i === e && chain.length > 1) break;
    }
    const simplified = simplifyChain(chain);
    out.push(...simplified.slice(0, -1));
  }
  return out;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;
}

// --- projection ------------------------------------------------------------------------------
let minLon = Infinity;
let maxLon = -Infinity;
let minLat = Infinity;
let maxLat = -Infinity;
for (const r of regions)
  for (const poly of r.polys)
    for (const [lon, lat] of poly[0]) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
const scale = WIDTH / ((maxLon - minLon) * kx);
const height = Math.ceil((maxLat - minLat) * scale);
const project = ([lon, lat]) => [round((lon - minLon) * kx * scale, 1), round((maxLat - lat) * scale, 1)];

// --- label point: the inner point farthest from the border (coarse grid search) --------------
function inside(pt, rings) {
  let c = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
    }
  return c;
}
function labelPoint(rings) {
  const outer = rings[0];
  const xs = outer.map((p) => p[0]);
  const ys = outer.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = [(x0 + x1) / 2, (y0 + y1) / 2];
  let bestD = -1;
  const steps = 40;
  for (let i = 0; i <= steps; i++)
    for (let j = 0; j <= steps; j++) {
      const p = [x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * j) / steps];
      if (!inside(p, rings)) continue;
      let d = Infinity;
      for (const ring of rings)
        for (let k = 0, m = ring.length - 1; k < ring.length; m = k++) d = Math.min(d, segDist(p, ring[m], ring[k]));
      if (d > bestD) [best, bestD] = [p, d];
    }
  return [round(best[0], 1), round(best[1], 1)];
}

// --- output ----------------------------------------------------------------------------------
const out = regions
  .map((r) => {
    const polys = r.polys
      .map((poly) => poly.map((ring) => simplifyRing(ring).map(project)).filter((ring) => ring.length >= 3))
      .filter((poly) => poly.length > 0 && Math.abs(ringArea(poly[0])) / scale ** 2 >= MIN_RING_AREA);
    const d = polys.flatMap((poly) => poly.map((ring) => `M${ring.map((p) => `${p[0]} ${p[1]}`).join('L')}Z`)).join('');
    const main = polys.reduce((a, b) => (Math.abs(ringArea(b[0])) > Math.abs(ringArea(a[0])) ? b : a));
    return { code: r.code, d, label: labelPoint(main), points: polys.flat(2).length };
  })
  .sort((a, b) => a.code.localeCompare(b.code));

console.error(out.map((r) => `${r.code}: ${r.points} points`).join('\n'));
console.log(
  JSON.stringify(
    {
      source: 'Natural Earth 1:10m admin-1 states/provinces (public domain), simplified',
      viewBox: `0 0 ${WIDTH} ${height}`,
      regions: out.map(({ code, d, label }) => ({ code, d, label })),
    },
    null,
    0,
  ),
);
