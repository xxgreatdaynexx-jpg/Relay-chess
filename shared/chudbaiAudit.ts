/**
 * Layout audit for Chudbai (used by tests/chudbai-layout.test.ts and the map QA hook): returns human-readable
 * problems. Empty = no two models overlap, nothing stands on a road, the network flows and every building fronts a road.
 */
import { GULF_SPOTS, G_TRACTS, G_UNITS, G_WELLS_PER_TRACT, gTractInfo, type GUnitKind } from './chudbai.js';
import {
  GULF_LANES, GULF_LOTS, GULF_PROPS, GULF_ROADS, METRO_GUIDEWAY, METRO_PILLARS, METRO_STATIONS, PALM_CRESCENT, PALM_FRONDS, PALM_HOTEL, PALM_SPINE, PALM_VILLAS,
  PIPE_CORRIDOR, PLANT_FLARE, PLANT_RACK, CAR_L, CAR_W, carX, carriage, corridor, inside, isHorizontal, medianRect, metroStationBox, onLand, overlaps, overlaps3,
  padRect, partRect, pillarBox, pipeStub, propBoxes, rect, rectOf, spotRect, unitSlot, walkSegments, wellSlot, type Box3, type Rect, type Road,
} from './chudbaiCity.js';

export interface Solid extends Box3 { id: string; kind: string; parent?: string }
const B = (r: Rect, y0: number, y1: number): Box3 => ({ ...r, y0, y1 });

/** Every static model on the map as a 3D box: lots, landmarks, oil pads and wells, plant slots, props, metro. */
export function gulfSolids(): Solid[] {
  const out: Solid[] = [];
  for (const s of GULF_SPOTS) out.push({ ...B(spotRect(s), 0, s.h), id: s.id, kind: 'spot' });
  for (const l of GULF_LOTS) out.push({ ...B(l.r, 0, l.h), id: `lot:${l.id}`, kind: 'lot' });
  for (let n = 1; n <= G_TRACTS; n++) {
    out.push({ ...B(padRect(n), 0, 0.4), id: `pad:${n}`, kind: 'pad' });
    for (let i = 0; i < G_WELLS_PER_TRACT; i++) out.push({ ...B(wellSlot(n, i), 0, gTractInfo(n).offshore ? 19 : 11), id: `well:${n}:${i}`, kind: 'well', parent: `pad:${n}` });
    const st = pipeStub(n); if (st) out.push({ ...B(st, 0, 1.5), id: `stub:${n}`, kind: 'pipe' });
  }
  out.push({ ...B(PIPE_CORRIDOR, 0, 1.5), id: 'pipe-corridor', kind: 'pipe' });
  for (const k of Object.keys(G_UNITS) as GUnitKind[]) for (let i = 0; i < G_UNITS[k].max; i++) out.push({ ...B(unitSlot(k, i), 0, 17), id: `unit:${k}:${i}`, kind: 'unit', parent: 'g-plant' });
  out.push({ ...B(PLANT_RACK, 0, 8), id: 'plant-rack', kind: 'unit', parent: 'g-plant' }, { ...B(PLANT_FLARE, 0, 36), id: 'plant-flare', kind: 'unit', parent: 'g-plant' });
  out.push({ ...B(PALM_SPINE, 0, 1), id: 'palm-spine', kind: 'palmland', parent: 'g-palm' });
  PALM_FRONDS.forEach((f) => out.push({ ...B(f.r, 0, 1), id: `frond:${f.side}:${f.i}`, kind: 'palmland', parent: 'g-palm' }));
  PALM_VILLAS.forEach((v, i) => out.push({ ...B(v.r, 1, 9), id: `pvilla:${i}`, kind: 'villa', parent: 'g-palm' }));
  out.push({ ...B(PALM_HOTEL, 0, 22), id: 'palm-hotel', kind: 'hotel', parent: 'g-palm' });
  GULF_PROPS.forEach((p, i) => propBoxes(p).forEach((b, j) => out.push({ ...b, id: `prop:${p.k}:${i}${j ? ':crown' : ''}`, kind: p.k })));
  METRO_PILLARS.forEach((p, i) => out.push({ ...pillarBox(p), id: `pillar:${i}`, kind: 'pillar' }));
  out.push({ ...METRO_GUIDEWAY, id: 'metro-guideway', kind: 'metro' });
  METRO_STATIONS.forEach((s) => out.push({ ...metroStationBox(s.x), id: `station:${s.name}`, kind: 'metro' }));
  for (const l of GULF_LOTS) for (const [i, p] of l.palms.entries()) out.push({ ...B(rectOf(p.x, p.z, 0.7 * p.s, 0.7 * p.s), 0, 7 * p.s), id: `lotpalm:${l.id}:${i}`, kind: 'palm', parent: `lot:${l.id}` });
  return out;
}

const fmt = (r: Rect) => `[${r.x0.toFixed(1)},${r.z0.toFixed(1)}→${r.x1.toFixed(1)},${r.z1.toFixed(1)}]`;
const chainParent = (s: Solid, by: Map<string, Solid>, id: string) => { let p = s.parent; while (p) { if (p === id) return true; p = by.get(p)?.parent; } return false; };
/** Pairs allowed to touch/stack: the metro deck on its pillars and guideway, a lot's own palms, palm-land pieces under villas. */
function allowed(a: Solid, b: Solid, by: Map<string, Solid>) {
  if (chainParent(a, by, b.id) || chainParent(b, by, a.id)) return true;
  if (a.kind === 'metro' && b.kind === 'metro') return true;
  if (a.id.replace(':crown', '') === b.id.replace(':crown', '')) return true; // a palm's own trunk and canopy
  if ((a.kind === 'palmland' && (b.kind === 'villa' || b.kind === 'hotel')) || (b.kind === 'palmland' && (a.kind === 'villa' || a.kind === 'hotel'))) return true;
  if (a.kind === 'pipe' && b.kind === 'pipe') return true;
  return false;
}

export function auditOverlaps(): string[] {
  const all = gulfSolids(); const by = new Map(all.map((s) => [s.id, s])); const bad: string[] = [];
  for (const s of all) if (s.parent) { const p = by.get(s.parent); if (p && !inside(s, p)) bad.push(`${s.id} sticks out of ${p.id} ${fmt(s)} vs ${fmt(p)}`); }
  // lot parts stay inside their lot
  for (const l of GULF_LOTS) for (const p of l.parts) if (!inside(partRect(p), l.r)) bad.push(`part ${p.s}/${p.m} of lot:${l.id} sticks out ${fmt(partRect(p))} vs ${fmt(l.r)}`);
  // The curved breakwater must clear every frond. Sample the exact rendered segment bounds (conservative AABBs).
  { const c = PALM_CRESCENT; const segs = 36;
    for (let i = 0; i < segs; i++) { const a = c.a0 + (c.a1 - c.a0) * (i + 0.5) / segs; const len = c.r * (c.a1 - c.a0) / segs + 0.4;
      const wx = Math.abs(Math.sin(a)) * len + Math.abs(Math.cos(a)) * c.width, dz = Math.abs(Math.cos(a)) * len + Math.abs(Math.sin(a)) * c.width;
      const r = rectOf(c.x + Math.cos(a) * c.r, c.z + Math.sin(a) * c.r, wx, dz);
      for (const f of PALM_FRONDS) if (overlaps(r, f.r)) bad.push(`crescent segment ${i} touches frond ${f.i}/${f.side}`);
    }
  }
  // pairwise (sweep on x)
  const s = [...all].sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length && s[j]!.x0 < s[i]!.x1; j++) {
    const a = s[i]!, b = s[j]!; if (!overlaps3(a, b) || allowed(a, b, by)) continue; bad.push(`overlap ${a.id} × ${b.id}`);
  }
  return bad;
}

/** Nothing but cars (carriageway), lamps/palms/benches/shelters (sidewalks, boulevard medians) and metro pillars (highway median) on a road. */
export function auditRoads(): string[] {
  const bad: string[] = []; const all = gulfSolids();
  const carr = GULF_ROADS.map((r) => ({ r, c: carriage(r), m: medianRect(r), w: walkSegments(r) }));
  for (const s of all) {
    for (const { r, c, m, w } of carr) {
      if (s.kind === 'pillar') { if (overlaps(s, c) && !(r.id === 'hwy' && m && inside(s, m))) bad.push(`${s.id} on ${r.id} outside the median`); continue; }
      if (s.kind === 'metro') continue; // elevated above the road
      const prop = s.kind === 'lamp' || s.kind === 'palm' || s.kind === 'bench' || s.kind === 'shelter';
      const crown = s.id.endsWith(':crown');
      if (crown) continue; // palm canopies overhang the kerb at 5 m+
      if (prop && !s.parent) { // street props: must be fully on a sidewalk or a boulevard median of their own road
        if (overlaps(s, c) && !(m && inside(s, m))) bad.push(`${s.id} stands on the ${r.id} carriageway`);
        continue;
      }
      if (overlaps(s, c)) bad.push(`${s.id} sits on ${r.id} carriageway ${fmt(s)}`);
      for (const ws of w) if (overlaps(s, ws)) bad.push(`${s.id} sits on the ${r.id} sidewalk ${fmt(s)}`);
    }
  }
  // land footprints stay off the beach; water landmarks are the only things south of it
  for (const s of all) if ((s.kind === 'lot') && !onLand(s)) bad.push(`${s.id} is on the beach`);
  // traffic: every car inside its carriageway, no two cars touching, sampled over a minute
  for (const t of [0, 7.3, 19.9, 31.1, 59.9]) {
    const cars: Array<Rect & { id: string }> = [];
    for (const [li, l] of GULF_LANES.entries()) for (let i = 0; i < l.n; i++) { const x = carX(l, i, t); cars.push({ ...rectOf(x, l.z, CAR_L, CAR_W), id: `car:${li}:${i}` }); const r = GULF_ROADS.find((o) => o.id === l.road)!; const c = carriage(r); const m = medianRect(r); if (!inside(rectOf(x, l.z, CAR_L, CAR_W), c) || (m && overlaps(rectOf(x, l.z, CAR_L, CAR_W), m))) bad.push(`car ${li}:${i} leaves its lane at t=${t}`); }
    cars.sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length && cars[j]!.x0 < cars[i]!.x1; j++) if (overlaps(cars[i]!, cars[j]!)) bad.push(`cars ${cars[i]!.id} × ${cars[j]!.id} collide at t=${t}`);
  }
  return bad;
}

const onLine = (r: Road, x: number, z: number) => isHorizontal(r) ? Math.abs(z - r.z0) < 0.01 && x >= r.x0 - 0.01 && x <= r.x1 + 0.01 : Math.abs(x - r.x0) < 0.01 && z >= r.z0 - 0.01 && z <= r.z1 + 0.01;
/** Road graph: connected, junctions only where centrelines meet exactly, no near-miss stubs, dead ends only at the map edge or a landmark. */
export function auditFlow(): string[] {
  const bad: string[] = []; const R = GULF_ROADS; const ends = (r: Road) => [[r.x0, r.z0], [r.x1, r.z1]] as const;
  // 1. every endpoint: on another road's centreline, or a declared dead end that really reaches its target
  for (const r of R) ends(r).forEach(([x, z], k) => {
    const joins = R.some((o) => o !== r && onLine(o, x, z));
    const tag = r.ends?.[k];
    if (joins) return;
    if (!tag) { bad.push(`dead stub: ${r.id} end ${k} at (${x},${z})`); return; }
    if (tag === 'edge') { if (Math.abs(x) < 319 && Math.abs(z) < 159) bad.push(`${r.id} is tagged as leaving the map but stops at (${x},${z})`); return; }
    const s = GULF_SPOTS.find((q) => q.id === tag); if (!s) { bad.push(`${r.id} ends at unknown ${tag}`); return; }
    const sr = spotRect(s); const c = carriage(r); const gap = Math.max(sr.x0 - c.x1, c.x0 - sr.x1, sr.z0 - c.z1, c.z0 - sr.z1);
    if (gap > 1) bad.push(`${r.id} stops ${gap.toFixed(1)} m short of ${tag}`);
  });
  // 2. clean junctions: crossing centrelines must meet at a point both roads contain; no endpoint may sit inside another carriageway off its centreline
  for (const r of R) ends(r).forEach(([x, z]) => {
    for (const o of R) { if (o === r || onLine(o, x, z)) continue; const c = carriage(o); if (x > c.x0 + 0.01 && x < c.x1 - 0.01 && z > c.z0 + 0.01 && z < c.z1 - 0.01) bad.push(`messy junction: ${r.id} ends inside ${o.id} off its centreline`); }
  });
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const a = R[i]!, b = R[j]!;
    if (isHorizontal(a) === isHorizontal(b)) { if (overlaps(carriage(a), carriage(b))) bad.push(`parallel roads overlap: ${a.id} / ${b.id}`); continue; }
    if (overlaps(carriage(a), carriage(b))) { const h = isHorizontal(a) ? a : b, v = isHorizontal(a) ? b : a; if (!(onLine(h, v.x0, h.z0) && onLine(v, v.x0, h.z0))) bad.push(`roads ${a.id} and ${b.id} cross without a junction`); }
  }
  // 3. junction spacing along each road (no two junctions closer than 20 m)
  for (const r of R) {
    const js = R.filter((o) => o !== r && isHorizontal(o) !== isHorizontal(r)).map((o) => (isHorizontal(r) ? o.x0 : o.z0)).filter((p) => isHorizontal(r) ? onLine(r, p, r.z0) && R.some((o) => !isHorizontal(o) && o.x0 === p && onLine(o, p, r.z0)) : onLine(r, r.x0, p)).sort((a, b) => a - b);
    const u = [...new Set(js)]; for (let i = 1; i < u.length; i++) if (u[i]! - u[i - 1]! < 20) bad.push(`junctions on ${r.id} only ${u[i]! - u[i - 1]!} m apart`);
  }
  // 4. connected
  const seen = new Set<string>([R[0]!.id]); const q = [R[0]!];
  while (q.length) { const r = q.pop()!; for (const o of R) if (!seen.has(o.id) && (ends(o).some(([x, z]) => onLine(r, x, z)) || ends(r).some(([x, z]) => onLine(o, x, z)))) { seen.add(o.id); q.push(o); } }
  for (const r of R) if (!seen.has(r.id)) bad.push(`${r.id} is not connected to the network`);
  return bad;
}

/** Every lot and every landmark faces a road: its front edge is within reach of a sidewalk or carriageway on that side. */
export function auditFrontage(): string[] {
  const bad: string[] = []; const zones = GULF_ROADS.flatMap((r) => [carriage(r), ...walkSegments(r), corridor(r)]);
  const fronts = (r: Rect, face: 'n' | 's' | 'e' | 'w', reach: number) => {
    const probe = face === 'n' ? rect(r.x0, r.z0 - reach, r.x1, r.z0) : face === 's' ? rect(r.x0, r.z1, r.x1, r.z1 + reach) : face === 'w' ? rect(r.x0 - reach, r.z0, r.x0, r.z1) : rect(r.x1, r.z0, r.x1 + reach, r.z1);
    return zones.some((z) => overlaps(probe, z));
  };
  for (const l of GULF_LOTS) if (!fronts(l.r, l.face, 3)) bad.push(`lot:${l.id} (${l.kind}) does not front a road on its ${l.face} side`);
  for (const s of GULF_SPOTS) if (!fronts(spotRect(s), s.face, 8)) bad.push(`${s.id} does not front a road on its ${s.face} side`);
  return bad;
}

export const auditGulf = () => [...auditOverlaps(), ...auditRoads(), ...auditFlow(), ...auditFrontage()];
export { PALM_CRESCENT };
