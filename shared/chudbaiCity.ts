/**
 * Chudbai city layout: one deterministic source for the street grid, districts, every building footprint, street
 * props, the metro, traffic lanes, the oil sites and the plant slots. The 3D map draws exactly these footprints, the
 * 2D map reads them, and tests/chudbai-layout.test.ts checks them (nothing overlaps, nothing sits on a road, the road
 * network is connected with clean junctions and no dead stubs, and every building fronts a road).
 * Coordinates: x east, z south (the Gulf is to the south). All footprints are axis-aligned rectangles.
 */
import { GULF_SPOTS, GULF_X0, GULF_X1, GULF_SHORE_Z, G_TRACTS, G_UNITS, G_WELLS_PER_TRACT, gTractInfo, gulfSpot, type GUnitKind, type GulfSpot } from './chudbai.js';

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Box3 extends Rect { y0: number; y1: number }
export const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });
export const rectOf = (x: number, z: number, w: number, d: number): Rect => ({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
export const inset = (r: Rect, m: number): Rect => ({ x0: r.x0 + m, z0: r.z0 + m, x1: r.x1 - m, z1: r.z1 - m });
const EPS = 0.01;
/** Strict overlap: rectangles that only touch do not overlap. */
export const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;
export const overlaps3 = (a: Box3, b: Box3) => overlaps(a, b) && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS;
export const inside = (a: Rect, outer: Rect) => a.x0 >= outer.x0 - EPS && a.x1 <= outer.x1 + EPS && a.z0 >= outer.z0 - EPS && a.z1 <= outer.z1 + EPS;
export const spotRect = (s: GulfSpot): Rect => rectOf(s.x, s.z, s.w, s.d);
function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

// ---------------------------------------------------------------- roads
export type RoadKind = 'highway' | 'boulevard' | 'street' | 'corniche' | 'access';
/** Axis-aligned road from (x0,z0) to (x1,z1) along its centreline. `w` = full carriageway (median included). Dead ends
 *  must name what they serve: 'edge' (leaves the map) or a spot id (a forecourt / turnaround at that landmark). */
export interface Road { id: string; name: string; kind: RoadKind; x0: number; z0: number; x1: number; z1: number; w: number; median: number; walk: number; ends?: [string | undefined, string | undefined] }
const H = (id: string, name: string, kind: RoadKind, z: number, x0: number, x1: number, w: number, median: number, walk: number, ends?: Road['ends']): Road => ({ id, name, kind, x0, z0: z, x1, z1: z, w, median, walk, ...(ends ? { ends } : {}) });
const V = (id: string, name: string, kind: RoadKind, x: number, z0: number, z1: number, w: number, median: number, walk: number, ends?: Road['ends']): Road => ({ id, name, kind, x0: x, z0, x1: x, z1, w, median, walk, ...(ends ? { ends } : {}) });
export const isHorizontal = (r: Road) => r.z0 === r.z1;

export const Z_HWY = -50, Z_WASL = 0, Z_JUM = 40, Z_COR = 76, Z_N1 = -90, Z_N2 = -125;
/** South-of-highway avenues (HWY → Corniche). -55 runs only between the highway and Al Wasl. */
export const SOUTH_AVES = [-300, -250, -200, -150, -100, -10, 30, 70, 120, 170, 210, 250];
const AVE_NAME: Record<number, string> = { [-300]: 'Al Shindagha St', [-250]: 'Bastakiya St', [-200]: 'Creek Rd', [-150]: 'Meena Bazaar St', [-100]: 'Souk Rd', [-10]: 'Mohammed bin Chud Blvd', 30: 'Financial Centre Rd', 70: 'Sail Rd', 120: 'Marina Walk', 170: 'Yacht Club Rd', 210: 'Harbour Rd', 250: 'Port Gate Rd', [-55]: 'Burj Plaza Rd' };
const NW_AVES = [-300, -250, -200], NE_AVES = [210, 250, 300];

export const GULF_ROADS: Road[] = (() => {
  const r: Road[] = [];
  r.push(H('hwy', 'Sheikh Chud Road', 'highway', Z_HWY, -320, 320, 20, 6, 3, ['edge', 'edge']));
  r.push(H('wasl', 'Al Wasl Road', 'boulevard', Z_WASL, -300, 250, 14, 3, 3));
  r.push(H('jum-w', 'Jumeirah Street', 'street', Z_JUM, -300, -100, 8, 0, 2.5));
  r.push(H('jum-e', 'Jumeirah Street', 'street', Z_JUM, -10, 250, 8, 0, 2.5));
  r.push(H('cor', 'The Corniche', 'corniche', Z_COR, -300, 250, 10, 2, 3));
  for (const x of SOUTH_AVES) r.push(V(`ave${x}`, AVE_NAME[x]!, 'street', x, Z_HWY, Z_COR, 8, 0, 2.5));
  r.push(V('ave-55', AVE_NAME[-55]!, 'street', -55, Z_HWY, Z_WASL, 8, 0, 2.5));
  for (const x of [...NW_AVES, ...NE_AVES]) r.push(V(`n${x}`, x < 0 ? 'Chudeirah Hills Rd' : 'Desert Springs Rd', 'street', x, Z_N2, Z_HWY, 7, 0, 2.5));
  for (const [x0, x1, tag] of [[-300, -200, 'w'], [210, 300, 'e']] as const) {
    r.push(H(`n1${tag}`, tag === 'w' ? 'Hills Crescent' : 'Springs Crescent', 'street', Z_N1, x0, x1, 7, 0, 2.5));
    r.push(H(`n2${tag}`, tag === 'w' ? 'Hills Ring' : 'Springs Ring', 'street', Z_N2, x0, x1, 7, 0, 2.5));
  }
  r.push(V('plant-rd', 'Refinery Rd', 'access', 10, -72.5, Z_HWY, 8, 0, 0, ['g-plant', undefined]));
  r.push(V('airport-rd', 'Airport Rd', 'access', 140, -100.5, Z_HWY, 10, 2, 0, ['g-airport', undefined]));
  r.push(V('palm-trunk', 'Palm Trunk', 'access', -10, Z_COR, 112, 8, 0, 1.5, [undefined, 'g-palm']));
  r.push(V('sail-cw', 'Burj al Chud Causeway', 'access', 70, Z_COR, 118.5, 7, 0, 0, [undefined, 'g-sail']));
  return r;
})();
export const roadById = (id: string) => GULF_ROADS.find((r) => r.id === id)!;
/** Full carriageway rectangle (median included). */
export function carriage(r: Road): Rect { return isHorizontal(r) ? rect(r.x0, r.z0 - r.w / 2, r.x1, r.z0 + r.w / 2) : rect(r.x0 - r.w / 2, r.z0, r.x0 + r.w / 2, r.z1); }
export function medianRect(r: Road): Rect | null { if (!r.median) return null; return isHorizontal(r) ? rect(r.x0, r.z0 - r.median / 2, r.x1, r.z0 + r.median / 2) : rect(r.x0 - r.median / 2, r.z0, r.x0 + r.median / 2, r.z1); }
/** Road + sidewalks. */
export function corridor(r: Road): Rect { const e = r.w / 2 + r.walk; return isHorizontal(r) ? rect(r.x0, r.z0 - e, r.x1, r.z0 + e) : rect(r.x0 - e, r.z0, r.x0 + e, r.z1); }
/** Sidewalk strips, cut where another road crosses (so a sidewalk never runs across a junction). */
export function walkSegments(r: Road): Rect[] {
  if (!r.walk) return [];
  const hz = isHorizontal(r); const out: Rect[] = [];
  for (const side of [-1, 1]) {
    const a = r.w / 2, b = r.w / 2 + r.walk; const lo = side < 0 ? -b : a, hi = side < 0 ? -a : b;
    let spans: Array<[number, number]> = [[hz ? r.x0 : r.z0, hz ? r.x1 : r.z1]];
    for (const o of GULF_ROADS) {
      if (o === r || isHorizontal(o) === hz) continue; const c = carriage(o);
      const across = hz ? [c.z0, c.z1] : [c.x0, c.x1]; const at = hz ? r.z0 : r.x0;
      if (!(at + lo < across[1]! && at + hi > across[0]!)) continue;
      const cut: [number, number] = hz ? [c.x0, c.x1] : [c.z0, c.z1];
      spans = spans.flatMap(([s0, s1]) => (cut[1] <= s0 || cut[0] >= s1) ? [[s0, s1] as [number, number]] : [[s0, cut[0]] as [number, number], [cut[1], s1] as [number, number]].filter(([p, q]) => q - p > 0.5));
    }
    for (const [s0, s1] of spans) out.push(hz ? rect(s0, r.z0 + lo, s1, r.z0 + hi) : rect(r.x0 + lo, s0, r.x0 + hi, s1));
  }
  return out;
}
/** Every rectangle a building may not touch: carriageways and sidewalks. */
export const roadZones = (): Rect[] => GULF_ROADS.flatMap((r) => [carriage(r), ...walkSegments(r)]);

// ---------------------------------------------------------------- districts
export type District = 'downtown' | 'marina' | 'oldtown' | 'residential' | 'industrial';
export const DISTRICTS: Record<District, { label: string; blurb: string; color: string }> = {
  downtown: { label: 'Downtown Chudbai', blurb: 'Burj Chudifa, the Mall, the Exchange and the tallest towers.', color: '#c8d6e0' },
  marina: { label: 'Chudbai Marina', blurb: 'Waterfront towers, hotels and penthouses around the yacht basin.', color: '#b8d8e8' },
  oldtown: { label: 'Al Chudha Old Town', blurb: 'Wind-tower houses, mosques, souks and the creek dhow wharf.', color: '#e4c89a' },
  residential: { label: 'Chudeirah Hills & Desert Springs', blurb: 'Walled villas, low-rise apartments, parks and local mosques.', color: '#e8dcc0' },
  industrial: { label: 'Jebel Chud Industrial', blurb: 'Warehouses, truck depots, the container port and the refinery.', color: '#c0b8a8' },
};
export function districtAt(x: number, z: number): District {
  if (z < Z_HWY) return 'residential';
  if (x < -100) return 'oldtown';
  if (x < 70) return 'downtown';
  if (x < 210) return 'marina';
  return 'industrial';
}
export const DOWNTOWN_CORE = { x: -55, z: 30 }, MARINA_CORE = { x: 145, z: 62 };
export const DISTRICT_LABELS: Array<{ d: District; x: number; z: number }> = [
  { d: 'oldtown', x: -225, z: 20 }, { d: 'downtown', x: -30, z: -25 }, { d: 'marina', x: 140, z: 20 }, { d: 'industrial', x: 285, z: -25 }, { d: 'residential', x: -250, z: -108 }, { d: 'residential', x: 255, z: -108 },
];

// ---------------------------------------------------------------- lots & parts
export type LotKind = 'tower' | 'hotel' | 'parking' | 'plaza' | 'mosque' | 'courtyard' | 'shop' | 'villa' | 'apartment' | 'park' | 'warehouse' | 'depot';
export type MatKey = `glass${0 | 1 | 2 | 3 | 4}` | `wall${0 | 1 | 2 | 3}` | 'cream' | 'stone' | 'white' | 'gold' | 'goldGlow' | 'dark' | 'steel' | 'conc' | 'paving' | 'lawn' | 'pool' | 'lot' | 'metal' | 'awning0' | 'awning1' | 'awning2' | 'navRed' | 'door' | 'truck' | 'teal';
/** One drawable piece of a building. box: w×d×h; cyl: diameter w; dome: hemisphere of diameter w; cone: diameter w. */
export interface Part { s: 'box' | 'cyl' | 'dome' | 'cone'; x: number; z: number; w: number; d: number; y0: number; h: number; m: MatKey }
export interface Lot { id: string; district: District; kind: LotKind; r: Rect; face: 'n' | 's' | 'e' | 'w'; h: number; parts: Part[]; palms: Array<{ x: number; z: number; s: number }>; deed?: string }
export const partRect = (p: Part): Rect => rectOf(p.x, p.z, p.w, p.d);

export interface Block { id: string; r: Rect; district: District; faces: Array<'n' | 's' | 'e' | 'w'> }
const zEdge = (z: number, side: 1 | -1) => { const r = GULF_ROADS.find((o) => isHorizontal(o) && o.z0 === z)!; return z + side * (r.w / 2 + r.walk); };
const xEdge = (x: number, side: 1 | -1, w = 8, walk = 2.5) => x + side * (w / 2 + walk);
/** The street blocks (inside the sidewalks). Landmark spots are cut out of them before lots are laid. */
export const GULF_BLOCKS: Block[] = (() => {
  const out: Block[] = []; const all: Array<'n' | 's' | 'e' | 'w'> = ['n', 's', 'e', 'w'];
  const rowA = [zEdge(Z_HWY, 1), zEdge(Z_WASL, -1)] as const, rowB = [zEdge(Z_WASL, 1), zEdge(Z_JUM, -1)] as const, rowC = [zEdge(Z_JUM, 1), zEdge(Z_COR, -1)] as const;
  const colsA = [-300, -250, -200, -150, -100, -55, -10, 30, 70, 120, 170, 210, 250];
  for (let i = 0; i + 1 < colsA.length; i++) out.push({ id: `a${colsA[i]}`, r: rect(xEdge(colsA[i]!, 1), rowA[0], xEdge(colsA[i + 1]!, -1), rowA[1]), district: districtAt((colsA[i]! + colsA[i + 1]!) / 2, -20), faces: all });
  out.push({ id: 'a250', r: rect(xEdge(250, 1), rowA[0], GULF_X1 - 4, rowA[1]), district: 'industrial', faces: ['n', 'w'] });
  const cols = SOUTH_AVES;
  for (let i = 0; i + 1 < cols.length; i++) {
    const x0 = xEdge(cols[i]!, 1), x1 = xEdge(cols[i + 1]!, -1); const d = districtAt((cols[i]! + cols[i + 1]!) / 2, 30);
    if (cols[i] === -100) { out.push({ id: 'bc-100', r: rect(x0, rowB[0], x1, rowC[1]), district: d, faces: all }); continue; } // Burj superblock (no Jumeirah St here)
    out.push({ id: `b${cols[i]}`, r: rect(x0, rowB[0], x1, rowB[1]), district: d, faces: all });
    out.push({ id: `c${cols[i]}`, r: rect(x0, rowC[0], x1, rowC[1]), district: d, faces: all });
  }
  for (const [aves, z0, z1, tag] of [[NW_AVES, Z_N2, Z_N1, 'nw2'], [NW_AVES, Z_N1, Z_HWY, 'nw1'], [NE_AVES, Z_N2, Z_N1, 'ne2'], [NE_AVES, Z_N1, Z_HWY, 'ne1']] as const) {
    for (let i = 0; i + 1 < aves.length; i++) out.push({ id: `${tag}${aves[i]}`, r: rect(xEdge(aves[i]!, 1, 7), z0 + 3.5 + 2.5, xEdge(aves[i + 1]!, -1, 7), z1 === Z_HWY ? zEdge(Z_HWY, -1) : z1 - 6), district: 'residential', faces: all });
  }
  return out;
})();

const LAND_SPOTS = GULF_SPOTS.filter((s) => !s.water);
/** Pieces of a block left after cutting out landmark spots (only the Burj superblock is split this way). */
function freeRects(b: Block): Rect[] {
  const hit = LAND_SPOTS.filter((s) => overlaps(spotRect(s), b.r)); if (!hit.length) return [b.r];
  if (b.id !== 'bc-100') return []; // a landmark takes the whole block
  const east = Math.max(...hit.map((s) => spotRect(s).x1)) + 2; return east < b.r.x1 - 10 ? [rect(east, b.r.z0, b.r.x1, b.r.z1)] : [];
}

/** Blocks that get a mosque on their north row (old town and the two villa suburbs). */
const MOSQUE_BLOCKS = new Set(['b-250', 'c-200', 'a-150', 'b-300', 'nw1-250', 'ne1250', 'a-100']);
const PLAN: Record<District, { tw: number; rowMin: number }> = { downtown: { tw: 16, rowMin: 11 }, marina: { tw: 17, rowMin: 11 }, oldtown: { tw: 9, rowMin: 8 }, residential: { tw: 13, rowMin: 8 }, industrial: { tw: 24, rowMin: 11 } };
const SET = 1, GAP = 1.6;
function kindFor(d: District, u: number, w: number, dd: number, slot: number): LotKind {
  if (d === 'downtown') return u < 0.07 ? 'plaza' : u < 0.14 ? 'parking' : u < 0.25 ? 'hotel' : 'tower';
  if (d === 'marina') return u < 0.08 ? 'plaza' : u < 0.12 ? 'parking' : u < 0.24 ? 'hotel' : 'tower';
  if (d === 'oldtown') return u < 0.3 ? 'shop' : 'courtyard';
  if (d === 'residential') return u < 0.08 ? 'park' : u < 0.32 ? 'apartment' : 'villa';
  return u < 0.6 ? 'warehouse' : 'depot';
}
function towerHeight(d: District, x: number, z: number, u: number, w: number, dd: number) {
  const k = Math.min(w, dd);
  if (d === 'downtown') return Math.min(k * 9, 34 + 92 * Math.exp(-Math.hypot(x - DOWNTOWN_CORE.x, z - DOWNTOWN_CORE.z) / 75) * (0.65 + 0.7 * u));
  return Math.min(k * 9, 30 + 78 * Math.exp(-Math.hypot(x - MARINA_CORE.x, z - MARINA_CORE.z) / 60) * (0.65 + 0.7 * u));
}

/** Parts for one lot; every part stays inside the lot rectangle (checked by the layout test). */
function partsFor(kind: LotKind, r: Rect, face: Lot['face'], h: number, u: () => number): { parts: Part[]; palms: Lot['palms']; h: number } {
  const P: Part[] = []; const palms: Lot['palms'] = []; const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, w = r.x1 - r.x0, d = r.z1 - r.z0;
  const box = (x: number, z: number, bw: number, bd: number, y0: number, bh: number, m: MatKey) => P.push({ s: 'box', x, z, w: bw, d: bd, y0, h: bh, m });
  const fx = face === 'e' ? 1 : face === 'w' ? -1 : 0, fz = face === 's' ? 1 : face === 'n' ? -1 : 0; // front direction
  const front = (off: number) => ({ x: cx + fx * (w / 2 - off), z: cz + fz * (d / 2 - off) });
  const door = (y0 = 0) => { const p = front(0.25); box(p.x, p.z, fx ? 0.5 : Math.min(3, w * 0.3), fz ? 0.5 : Math.min(3, d * 0.3), y0, 2.8, 'door'); };
  const st = Math.floor(u() * 5) as 0 | 1 | 2 | 3 | 4; const wall = (Math.floor(u() * 4)) as 0 | 1 | 2 | 3;
  switch (kind) {
    case 'tower': case 'hotel': {
      const pod = kind === 'hotel' ? 6 : 5 + Math.round(u() * 4); box(cx, cz, w - 0.4, d - 0.4, 0, pod, u() < 0.5 ? 'cream' : 'stone'); door();
      const tw = (w - 0.4) * (kind === 'hotel' ? 0.82 : 0.68), td = (d - 0.4) * (kind === 'hotel' ? 0.82 : 0.68);
      const top = kind === 'hotel' ? pod + 14 + u() * 16 : Math.max(pod + 24, h);
      box(cx, cz, tw, td, pod, top - pod, kind === 'hotel' ? `wall${wall}` : `glass${st}`);
      if (kind === 'hotel') { box(cx, cz, tw * 0.9, td * 0.9, top, 1.2, 'gold'); const p = front(0.9); box(p.x, p.z, fx ? 1.4 : w * 0.55, fz ? 1.4 : d * 0.55, 3.2, 0.4, 'gold'); return { parts: P, palms, h: top + 1.2 }; }
      let peak = top;
      if (st % 3 === 0) { box(cx, cz, tw * 0.7, td * 0.7, top, top * 0.16, `glass${st}`); box(cx, cz, tw * 0.72, td * 0.72, top + top * 0.16, 0.6, 'gold'); P.push({ s: 'cyl', x: cx, z: cz, w: 0.5, d: 0.5, y0: top + top * 0.16 + 0.6, h: top * 0.1, m: 'steel' }); peak = top * 1.26 + 0.6; }
      else if (st % 3 === 1) { P.push({ s: 'cone', x: cx, z: cz, w: Math.min(tw, td) * 0.9, d: Math.min(tw, td) * 0.9, y0: top, h: top * 0.12, m: 'gold' }); peak = top * 1.12; }
      else { box(cx, cz, tw + 0.3, td + 0.3, top * 0.5, 0.8, 'gold'); box(cx, cz, tw + 0.3, td + 0.3, top, 0.8, 'gold'); peak = top + 0.8; }
      box(cx, cz, 0.5, 0.5, peak, 0.5, 'navRed');
      return { parts: P, palms, h: peak + 0.5 };
    }
    case 'parking': { box(cx, cz, w - 0.4, d - 0.4, 0, 11, 'conc'); for (let y = 2.6; y < 11; y += 2.8) box(cx, cz, w - 0.38, d - 0.38, y, 0.4, 'dark'); door(); return { parts: P, palms, h: 11 }; }
    case 'plaza': case 'park': {
      box(cx, cz, w, d, 0, 0.15, kind === 'park' ? 'lawn' : 'paving'); P.push({ s: 'cyl', x: cx, z: cz, w: Math.min(w, d) * 0.35, d: Math.min(w, d) * 0.35, y0: 0.15, h: 0.6, m: 'pool' });
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) palms.push({ x: cx + sx * (w / 2 - 2.2), z: cz + sz * (d / 2 - 2.2), s: 0.8 });
      return { parts: P, palms, h: 0.75 };
    }
    case 'mosque': {
      const bw = w * 0.72, bd = d * 0.72; box(cx, cz, w, d, 0, 0.2, 'paving'); box(cx, cz, bw, bd, 0.2, 7, 'white'); door(0.2);
      const dr = Math.min(bw, bd) * 0.62; P.push({ s: 'cyl', x: cx, z: cz, w: dr * 1.02, d: dr * 1.02, y0: 7.2, h: 1.4, m: 'white' }); P.push({ s: 'dome', x: cx, z: cz, w: dr, d: dr, y0: 8.6, h: dr / 2, m: u() < 0.5 ? 'gold' : 'teal' });
      P.push({ s: 'cone', x: cx, z: cz, w: 0.6, d: 0.6, y0: 8.6 + dr / 2, h: 1.6, m: 'gold' });
      const corners = fz ? [[-1, fz], [1, fz]] : [[fx, -1], [fx, 1]];
      for (const [sx, sz] of corners) { const mx = cx + sx! * (w / 2 - 1.2), mz = cz + sz! * (d / 2 - 1.2); P.push({ s: 'cyl', x: mx, z: mz, w: 1.6, d: 1.6, y0: 0.2, h: 20, m: 'white' }); P.push({ s: 'cyl', x: mx, z: mz, w: 2.2, d: 2.2, y0: 15, h: 0.8, m: 'cream' }); P.push({ s: 'cone', x: mx, z: mz, w: 1.6, d: 1.6, y0: 20.2, h: 2.4, m: 'gold' }); }
      return { parts: P, palms, h: 22.6 };
    }
    case 'courtyard': {
      const hh = 5 + Math.round(u() * 3); box(cx, cz, w - 0.3, d - 0.3, 0, hh, `wall${2 + (wall % 2) as 2 | 3}`); door();
      const tx = cx + (u() < 0.5 ? -1 : 1) * (w / 2 - 1.6), tz = cz - fz * (d / 2 - 1.6) - (fz ? 0 : 0);
      box(tx, fz ? tz : cz, 1.8, 1.8, hh, 3.2, 'cream'); box(tx, fz ? tz : cz, 2.1, 2.1, hh + 3.2, 0.3, 'stone');
      return { parts: P, palms, h: hh + 3.5 };
    }
    case 'shop': {
      const hh = 4 + Math.round(u() * 2); box(cx, cz, w - 0.3, d - 0.3, 0, hh, `wall${wall}`); door();
      const p = front(0.75); box(p.x, p.z, fx ? 1.3 : w - 0.8, fz ? 1.3 : d - 0.8, 2.9, 0.25, (['awning0', 'awning1', 'awning2'] as const)[Math.floor(u() * 3)]!);
      return { parts: P, palms, h: hh };
    }
    case 'villa': {
      for (const [ax, az, aw, ad] of [[cx, r.z0 + 0.2, w, 0.4], [cx, r.z1 - 0.2, w, 0.4], [r.x0 + 0.2, cz, 0.4, d - 0.8], [r.x1 - 0.2, cz, 0.4, d - 0.8]] as const) box(ax, az, aw, ad, 0, 2.2, 'cream');
      const hw = w * 0.55, hd = d * 0.5; const hx = cx - (fx || (u() < 0.5 ? -1 : 1)) * (w / 2 - 0.6 - hw / 2) * (fx ? -1 : 1), hz = cz + (fz ? -fz : 1) * (d / 2 - 0.6 - hd / 2) * -1;
      box(hx, hz, hw, hd, 0, 6.5, `wall${wall}`); box(hx, hz, hw * 0.5, hd * 0.6, 6.5, 3, `wall${wall}`); box(hx, hz, hw + 0.2, hd + 0.2, 6.5, 0.25, 'stone');
      const px = cx + (cx - hx) * 0.9, pz = cz + (cz - hz) * 0.9; box(px, pz, Math.min(w * 0.3, 6), Math.min(d * 0.25, 4), 0, 0.25, 'pool');
      const p = front(0.3); box(p.x, p.z, fx ? 0.45 : 3, fz ? 0.45 : 3, 0, 2.4, 'gold');
      palms.push({ x: r.x0 + 1.4 + (hx < cx ? w - 2.8 : 0), z: r.z0 + 1.4 + (hz < cz ? d - 2.8 : 0), s: 0.55 });
      return { parts: P, palms, h: 9.5 };
    }
    case 'apartment': {
      const hh = 12 + Math.round(u() * 4) * 3; box(cx, cz, w - 0.6, d - 0.6, 0, hh, `wall${wall}`); for (let y = 3; y < hh; y += 3) box(cx, cz, w - 0.4, d - 0.4, y, 0.25, 'cream'); box(cx, cz, (w - 0.6) * 0.3, (d - 0.6) * 0.3, hh, 2.5, 'stone'); door();
      return { parts: P, palms, h: hh + 2.5 };
    }
    case 'warehouse': {
      box(cx, cz, w - 0.4, d - 0.4, 0, 8, 'metal'); const n = Math.max(2, Math.floor((w - 0.4) / 6)); for (let i = 0; i < n; i++) box(r.x0 + 0.2 + (i + 0.5) * (w - 0.4) / n, cz, (w - 0.4) / n - 0.4, d - 0.6, 8, 1.6, i % 2 ? 'steel' : 'metal');
      for (const k of [-1, 1]) { const p = front(0.25); box(fz ? p.x + k * w * 0.22 : p.x, fz ? p.z : p.z + k * d * 0.22, fx ? 0.5 : 4, fz ? 0.5 : 4, 0, 4.5, 'dark'); }
      return { parts: P, palms, h: 9.6 };
    }
    case 'depot': {
      box(cx, cz, w, d, 0, 0.12, 'lot'); const ox = cx - (w / 2 - 4), oz = cz; box(ox, oz, 6, Math.min(8, d - 2), 0.12, 4, 'wall1'); door();
      for (let i = 0; i < 3; i++) { const tx = ox + 6 + i * 5; if (tx + 1.5 > r.x1 - 0.5) break; box(tx, cz, 2.4, Math.min(9, d - 2), 0.12, 3.2, i % 2 ? 'truck' : 'white'); }
      return { parts: P, palms, h: 4.12 };
    }
  }
}

function layLots(): Lot[] {
  const out: Lot[] = []; const u = rng(20261122);
  for (const b of GULF_BLOCKS) for (const fr of freeRects(b)) {
    const plan = PLAN[b.district]; let R = inset(fr, SET);
    if (MOSQUE_BLOCKS.has(b.id)) { // a full-depth mosque on the block's west end, entrance on the north street
      const mw = Math.min((R.x1 - R.x0) * 0.42, 20); const mr = rect(R.x0, R.z0, R.x0 + mw, R.z1); const p = partsFor('mosque', mr, 'n', 0, u);
      out.push({ id: `${b.id}:mosque`, district: b.district, kind: 'mosque', r: mr, face: 'n', h: p.h, parts: p.parts, palms: p.palms }); R = rect(mr.x1 + GAP, R.z0, R.x1, R.z1);
    }
    const depth = R.z1 - R.z0; const width = R.x1 - R.x0; if (width < 6 || depth < 6) continue;
    const rows: Array<{ r: Rect; face: Lot['face'] }> = depth >= plan.rowMin * 2 + GAP && b.faces.includes('s') ? [{ r: rect(R.x0, R.z0, R.x1, (R.z0 + R.z1 - GAP) / 2), face: 'n' }, { r: rect(R.x0, (R.z0 + R.z1 + GAP) / 2, R.x1, R.z1), face: 's' }] : [{ r: R, face: b.faces.includes('s') && b.district === 'marina' ? 's' : 'n' }];
    for (const row of rows) {
      const rw = row.r.x1 - row.r.x0; const n = Math.max(1, Math.round((rw + GAP) / (plan.tw + GAP)));
      const lots: Rect[] = [];
      const x = row.r.x0;
      const lw = (row.r.x1 - x - (n - 1) * GAP) / n;
      for (let i = 0; i < n; i++) lots.push(rect(x + i * (lw + GAP), row.r.z0, x + i * (lw + GAP) + lw, row.r.z1));
      lots.forEach((lr, i) => {
        const w = lr.x1 - lr.x0, d = lr.z1 - lr.z0; const cx = (lr.x0 + lr.x1) / 2, cz = (lr.z0 + lr.z1) / 2;
        const kind = kindFor(b.district, u(), w, d, i);
        const th = kind === 'tower' ? towerHeight(b.district, cx, cz, u(), w, d) : 0;
        const p = partsFor(kind, lr, row.face, th, u);
        out.push({ id: `${b.id}:${row.face}${i}`, district: b.district, kind, r: lr, face: row.face, h: p.h, parts: p.parts, palms: p.palms });
      });
    }
  }
  return out;
}
export const GULF_LOTS: Lot[] = layLots();

// ---------------------------------------------------------------- street props
export type PropKind = 'lamp' | 'palm' | 'bench' | 'shelter';
export interface Prop { k: PropKind; x: number; z: number; s: number; road: string; zone: 'walk' | 'median' }
/** Ground footprint + height for the overlap checks (palms add their canopy as a second box). */
export function propBoxes(p: Prop): Box3[] {
  if (p.k === 'lamp') return [{ ...rectOf(p.x, p.z, 0.5, 0.5), y0: 0, y1: 6.4 }];
  if (p.k === 'bench') return [{ ...rectOf(p.x, p.z, 1.8, 0.6), y0: 0, y1: 0.9 }];
  if (p.k === 'shelter') return [{ ...rectOf(p.x, p.z, 4, 1.4), y0: 0, y1: 2.7 }];
  return [{ ...rectOf(p.x, p.z, 0.7 * p.s, 0.7 * p.s), y0: 0, y1: 7 * p.s }, { ...rectOf(p.x, p.z, 3.6 * p.s, 3.6 * p.s), y0: 6.2 * p.s, y1: 7.8 * p.s }];
}
const junctionBoxes = () => GULF_ROADS.map((r) => ({ r, c: inset(corridor(r), -1.5) }));
function layProps(): Prop[] {
  const out: Prop[] = []; const jb = junctionBoxes();
  const ok = (r: Road, x: number, z: number, pad: number) => !jb.some((j) => j.r !== r && x > j.c.x0 - pad && x < j.c.x1 + pad && z > j.c.z0 - pad && z < j.c.z1 + pad);
  for (const r of GULF_ROADS) {
    const hz = isHorizontal(r); const len = hz ? r.x1 - r.x0 : r.z1 - r.z0; const a0 = hz ? r.x0 : r.z0; const c = hz ? r.z0 : r.x0;
    const at = (s: number, off: number) => (hz ? { x: a0 + s, z: c + off } : { x: c + off, z: a0 + s });
    if (r.walk) for (const side of [-1, 1]) {
      const off = side * (r.w / 2 + r.walk / 2);
      for (let s = 6, k = 0; s < len - 3; s += 24, k++) {
        const L = at(s, off); if (ok(r, L.x, L.z, 0.5)) out.push({ k: 'lamp', ...L, s: 1, road: r.id, zone: 'walk' });
        if (r.kind !== 'highway' && s + 12 < len - 3) { const P = at(s + 12, off); if (ok(r, P.x, P.z, 2)) out.push({ k: 'palm', ...P, s: r.walk >= 3 ? 0.85 : 0.75, road: r.id, zone: 'walk' }); }
        if (r.id === 'cor' && side > 0 && k % 2 === 1) { const B = at(s + 6, off); if (ok(r, B.x, B.z, 1.5)) out.push({ k: 'bench', ...B, s: 1, road: r.id, zone: 'walk' }); }
        if (r.id === 'wasl' && k % 4 === 2) { const B = at(s + 6, off); if (ok(r, B.x, B.z, 2.5)) out.push({ k: 'shelter', ...B, s: 1, road: r.id, zone: 'walk' }); }
      }
    }
    if (r.median && r.kind !== 'highway' && r.kind !== 'access') for (let s = 10; s < len - 3; s += 20) { const P = at(s, 0); if (ok(r, P.x, P.z, 2)) out.push({ k: 'palm', ...P, s: r.median >= 3 ? 0.8 : 0.6, road: r.id, zone: 'median' }); }
  }
  return out;
}
export const GULF_PROPS: Prop[] = layProps();

// ---------------------------------------------------------------- metro (elevated, on the Sheikh Chud Road median)
export const METRO_Y = 7.6, METRO_X0 = -300, METRO_X1 = 300;
export const METRO_STATIONS = [{ x: -225, name: 'Al Chudha' }, { x: -125, name: 'Gold Souk' }, { x: -32, name: 'Burj Chudifa / The Mall' }, { x: 95, name: 'Chudbai Marina' }, { x: 230, name: 'Jebel Chud' }];
export const METRO_GUIDEWAY: Box3 = { ...rect(METRO_X0, Z_HWY - 1.2, METRO_X1, Z_HWY + 1.2), y0: METRO_Y, y1: METRO_Y + 1.4 };
export const metroStationBox = (x: number): Box3 => ({ ...rect(x - 14, Z_HWY - 6, x + 14, Z_HWY + 6), y0: METRO_Y + 1.4, y1: METRO_Y + 6 });
/** Pillars sit in the highway median, never inside a junction (cross traffic passes there). */
export const METRO_PILLARS: Array<{ x: number; z: number }> = (() => {
  const cross = GULF_ROADS.filter((r) => !isHorizontal(r) && r.z0 <= Z_HWY && r.z1 >= Z_HWY).map((r) => [r.x0 - r.w / 2 - r.walk - 3, r.x0 + r.w / 2 + r.walk + 3] as const);
  const out: Array<{ x: number; z: number }> = [];
  for (let x = METRO_X0 + 4; x <= METRO_X1 - 4; x += 16) if (!cross.some(([a, b]) => x + 0.8 > a && x - 0.8 < b)) out.push({ x, z: Z_HWY });
  return out;
})();
export const pillarBox = (p: { x: number; z: number }): Box3 => ({ ...rectOf(p.x, p.z, 1.6, 1.6), y0: 0, y1: METRO_Y });

// ---------------------------------------------------------------- traffic (east-west lanes only; same speed per lane, so cars never meet)
export interface Lane { road: string; z: number; dir: 1 | -1; speed: number; n: number; x0: number; x1: number }
export const CAR_L = 4.4, CAR_W = 1.9;
export const GULF_LANES: Lane[] = (() => {
  const out: Lane[] = [];
  for (const r of GULF_ROADS.filter((o) => isHorizontal(o) && o.w >= 10 && o.kind !== 'access')) {
    const per = (r.w - r.median) / 2; const lanes = per >= 7 ? 2 : 1; const lw = per / lanes;
    for (const dir of [1, -1] as const) for (let i = 0; i < lanes; i++) {
      const off = r.median / 2 + lw * (i + 0.5); const z = r.z0 + (dir > 0 ? off : -off); const len = r.x1 - r.x0;
      out.push({ road: r.id, z, dir, speed: r.kind === 'highway' ? (i ? 11 : 15) : r.kind === 'boulevard' ? 9 : 7, n: Math.max(2, Math.floor(len / (r.kind === 'highway' ? 26 : 34))), x0: r.x0 + 3, x1: r.x1 - 3 });
    }
  }
  return out;
})();
export function carX(l: Lane, i: number, t: number): number { const L = l.x1 - l.x0; const s = ((i * L) / l.n + l.speed * t) % L; return l.dir > 0 ? l.x0 + s : l.x1 - s; }

// ---------------------------------------------------------------- oil sites
export const TRACT_W = 30, TRACT_D = 26;
export const padRect = (n: number): Rect => { const t = gTractInfo(n); return rectOf(t.x, t.z, TRACT_W, TRACT_D); };
/** Well slot i on block n: desert wells are 5×3 pads, offshore wells are 9×9 platform decks. */
export function wellSlot(n: number, i: number): Rect {
  const t = gTractInfo(n); const sx = (i % 2 ? 1 : -1), sz = (i < 2 ? -1 : 1);
  return t.offshore ? rectOf(t.x + sx * 7.2, t.z + sz * 5.6, 9, 9) : rectOf(t.x + sx * 9, t.z + sz * 7, 5, 3);
}
/** Gathering line corridor between the two rows of desert blocks, into the plant's west side. */
export const PIPE_Z = -105;
export const PIPE_CORRIDOR: Rect = rect(-175, PIPE_Z - 2, gulfSpot('g-plant').x - gulfSpot('g-plant').w / 2, PIPE_Z + 2);
/** Stub from a desert block's edge to the corridor (offshore blocks use subsea lines and a riser). */
export function pipeStub(n: number): Rect | null { const t = gTractInfo(n); if (t.offshore) return null; const p = padRect(n); return t.z < PIPE_Z ? rect(t.x - 0.8, p.z1, t.x + 0.8, PIPE_CORRIDOR.z0) : rect(t.x - 0.8, PIPE_CORRIDOR.z1, t.x + 0.8, p.z0); }

// ---------------------------------------------------------------- plant (Desert Refining & LNG Complex) slots
const PLANT = gulfSpot('g-plant');
export const PLANT_RACK: Rect = rect(PLANT.x - 60, PLANT.z - 1.2, PLANT.x + 60, PLANT.z + 1.2);
export const PLANT_FLARE: Rect = rectOf(PLANT.x + 60, PLANT.z + 24, 2, 2);
const UNIT_SIZE: Record<GUnitKind, [number, number]> = { stabilizer: [10, 9], lng: [10, 9], refinery: [10, 9], aromatics: [10, 9], solar: [14, 11], tank: [7.6, 7.6] };
/** Slot for the i-th unit of a kind (every slot up to the kind's max is distinct and inside the plant). */
export function unitSlot(k: GUnitKind, i: number): Rect {
  const [w, d] = UNIT_SIZE[k];
  if (k === 'solar') return rectOf(PLANT.x - 52.5 + i * 15, PLANT.z - 26, w, d);
  if (k === 'tank') return rectOf(PLANT.x - 40.5 + i * 9, PLANT.z + 24, w, d);
  const north = k === 'stabilizer' || k === 'lng'; const j = k === 'stabilizer' || k === 'refinery' ? i : G_UNITS[k === 'lng' ? 'stabilizer' : 'refinery'].max + i;
  return rectOf(PLANT.x - 49.5 + j * 11, PLANT.z + (north ? -10 : 10), w, d);
}

// ---------------------------------------------------------------- Palm Chudeirah (axis-aligned fronds so footprints are exact)
const PALM = gulfSpot('g-palm');
export const PALM_SPINE: Rect = rect(-17, PALM.z - PALM.d / 2, -3, 160);
export const PALM_CRESCENT = { x: -10, z: 134, r: 58, width: 4.4, a0: 0.08 * Math.PI, a1: 0.92 * Math.PI };
export const PALM_FRONDS: Array<{ i: number; side: -1 | 1; r: Rect; signature: boolean }> = (() => {
  const out: Array<{ i: number; side: -1 | 1; r: Rect; signature: boolean }> = [];
  for (let i = 0; i < 8; i++) for (const side of [-1, 1] as const) {
    const z = 116 + i * 5.6; const L = 36 - Math.abs(i - 3.5) * 3.2; const sig = i === 3; const hd = sig ? 2.4 : 1.5;
    out.push({ i, side, signature: sig, r: side < 0 ? rect(PALM_SPINE.x0 - L, z - hd, PALM_SPINE.x0, z + hd) : rect(PALM_SPINE.x1, z - hd, PALM_SPINE.x1 + L, z + hd) });
  }
  return out;
})();
/** Frond villas (small) and the two Signature Villas at the tips of the widest fronds (deeds cb:5 and cb:6). */
export const PALM_VILLAS: Array<{ r: Rect; deed?: string }> = (() => {
  const out: Array<{ r: Rect; deed?: string }> = [];
  for (const f of PALM_FRONDS) {
    const L = f.r.x1 - f.r.x0; const zc = (f.r.z0 + f.r.z1) / 2;
    if (f.signature) { const tip = f.side < 0 ? f.r.x0 : f.r.x1; out.push({ r: f.side < 0 ? rect(tip + 0.4, f.r.z0 + 0.3, tip + 9.4, f.r.z1 - 0.3) : rect(tip - 9.4, f.r.z0 + 0.3, tip - 0.4, f.r.z1 - 0.3), deed: f.side < 0 ? 'cb:5' : 'cb:6' }); }
    for (let v = 3; v < L - (f.signature ? 11 : 2); v += 6) { const x = f.side < 0 ? f.r.x1 - v : f.r.x0 + v; out.push({ r: rectOf(x - f.side * 1.2, zc, 2.2, 2) }); }
  }
  return out;
})();
export const PALM_HOTEL: Rect = rectOf(-10, PALM_CRESCENT.z + PALM_CRESCENT.r, 16, 5.4);

// ---------------------------------------------------------------- deeds (buyable homes; ordinary deed rules, Chudbai-only purchase)
export interface ChudbaiDeed { id: string; label: string; type: 'penthouse' | 'villa'; price: number; r: Rect; h: number; blurb: string }
function pickDeeds(): ChudbaiDeed[] {
  const towers = (d: District) => GULF_LOTS.filter((l) => l.district === d && l.kind === 'tower').sort((a, b) => b.h - a.h || a.id.localeCompare(b.id));
  const mt = towers('marina'), dt = towers('downtown');
  const near = (kind: LotKind, d: District, x: number, z: number) => GULF_LOTS.filter((l) => l.kind === kind && l.district === d).sort((a, b) => Math.hypot((a.r.x0 + a.r.x1) / 2 - x, (a.r.z0 + a.r.z1) / 2 - z) - Math.hypot((b.r.x0 + b.r.x1) / 2 - x, (b.r.z0 + b.r.z1) / 2 - z))[0]!;
  const pick: Array<[Lot, string, ChudbaiDeed['type'], number, string]> = [
    [mt[0]!, 'Marina Crown Penthouse', 'penthouse', 4_500_000, 'Top two floors of the tallest marina tower, over the yacht basin.'],
    [mt[1]!, 'Marina Promenade Penthouse', 'penthouse', 3_500_000, 'Wraparound terrace above the marina promenade.'],
    [dt[0]!, 'Burj View Penthouse', 'penthouse', 6_000_000, 'Downtown sky penthouse looking straight at the Burj Chudifa.'],
    [near('courtyard', 'oldtown', -225, 70), 'Creekside Heritage House', 'villa', 2_400_000, 'A restored wind-tower courtyard house by the dhow wharf.'],
    [near('villa', 'residential', -250, -90), 'Chudeirah Hills Villa', 'villa', 3_000_000, 'Walled family villa with a pool in the Hills.'],
  ];
  const ids = ['cb:1', 'cb:2', 'cb:3', 'cb:4', 'cb:7'];
  const out: ChudbaiDeed[] = pick.map(([l, label, type, price, blurb], i) => { l.deed = ids[i]!; return { id: l.deed, label, type, price, r: l.r, h: l.h, blurb }; });
  for (const v of PALM_VILLAS) if (v.deed) out.push({ id: v.deed, label: v.deed === 'cb:5' ? 'Palm Frond Villa' : 'Palm Signature Villa', type: 'villa', price: v.deed === 'cb:5' ? 7_000_000 : 12_000_000, r: v.r, h: 8, blurb: v.deed === 'cb:5' ? 'Beach villa at the tip of a west frond, private beach and pool.' : 'The biggest villa on the Palm: east frond tip, sunset over the crescent.' });
  return out.sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)));
}
export const CHUDBAI_DEEDS: ChudbaiDeed[] = pickDeeds();
/** The deeds as real-estate properties on their own map ('chudbai'): normal deed rules, only buyable while in Chudbai (server-enforced). */
export function chudbaiProperties(): Array<{ id: string; kind: 'building'; type: string; label: string; price: number; x: number; z: number; w: number; d: number; rot: number; h: number; map: 'chudbai' }> {
  return CHUDBAI_DEEDS.map((d) => ({ id: d.id, kind: 'building' as const, type: d.type, label: d.label, price: d.price, x: (d.r.x0 + d.r.x1) / 2, z: (d.r.z0 + d.r.z1) / 2, w: d.r.x1 - d.r.x0, d: d.r.z1 - d.r.z0, rot: 0, h: d.h, map: 'chudbai' as const }));
}
export const isChudbaiDeedId = (id: unknown): boolean => typeof id === 'string' && /^cb:\d+$/.test(id) && CHUDBAI_DEEDS.some((d) => d.id === id);

// ---------------------------------------------------------------- shore checks
/** Land footprints must stay north of the beach (the Corniche promenade ends at the sand). */
export const BEACH_Z0 = Z_COR + 5 + 3;
export const onLand = (r: Rect) => r.z1 <= BEACH_Z0 + EPS;
export const SHORE_Z = GULF_SHORE_Z;
export { G_TRACTS, G_WELLS_PER_TRACT };
