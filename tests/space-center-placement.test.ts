/**
 * Automated overlap check for the decorative space-center campus, and wiring
 * so it sits on the live 3D city map with a 2D map marker and no gameplay.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPACE_CENTER, SPACE_CENTER_ID, SPACE_CENTER_OX, SPACE_CENTER_OZ } from '../shared/spaceCenter';
import { landmarks, LANDMARK_IDS, LANDMARK_SLOTS, MINE_SITES, MINE_APRON, RESERVED_VENUES, obbOverlap, type OBB } from '../shared/worldLayout';
import { properties } from '../shared/realEstate';
import { mapRoadSegments, inLake, LAKE } from '../shared/outskirts';
import { expRoadSegments } from '../shared/expansionRoads';
import { inRiver } from '../shared/expansionRiver';
import { inRiverLake } from '../shared/riverLake';
import { landCoveredAt, LAND_FILL, expansionPlotFootprints, expansionScenery, GOLDWOOD_GREEN, GOLDWOOD_POND, GOLDWOOD_GATES } from '../shared/expansionScenery';
import { AIRPORT, RACETRACK } from '../shared/venues';
import { JAIL_SITE, JAIL_SCALE } from '../shared/jail';
import { OCEAN } from '../shared/ocean';
import { GOLDWOOD } from '../shared/mapExpansion';
import { WORLD_SPOTS } from '../client/src/lib/worldSpots';
import { SPACE_CENTER_SIZE } from '../client/src/lib/spaceCenterModel';

const PAD = 2;
const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

function roadClearance(box: OBB, a: [number, number], b: [number, number], rw: number) {
  const x0 = box.x - box.w / 2, x1 = box.x + box.w / 2, z0 = box.z - box.d / 2, z1 = box.z + box.d / 2;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(4, Math.ceil(len / 2));
  let best = Infinity;
  for (let i = 0; i <= n; i++) {
    const t = i / n, sx = a[0] + (b[0] - a[0]) * t, sz = a[1] + (b[1] - a[1]) * t;
    const cx = Math.max(x0, Math.min(sx, x1)), cz = Math.max(z0, Math.min(sz, z1));
    best = Math.min(best, Math.hypot(sx - cx, sz - cz) - rw / 2);
  }
  return best;
}

/** Every forbidden overlap of a campus-sized OBB against live map geometry. */
export function spaceCenterOverlapHits(box: OBB = { ...SPACE_CENTER }): Array<{ kind: string; id: string; dist?: number }> {
  const out: Array<{ kind: string; id: string; dist?: number }> = [];
  const x0 = box.x - box.w / 2, x1 = box.x + box.w / 2, z0 = box.z - box.d / 2, z1 = box.z + box.d / 2;
  const samples: [number, number][] = [
    [x0, z0], [x1, z0], [x0, z1], [x1, z1], [box.x, box.z],
    [(x0 + x1) / 2, z0], [(x0 + x1) / 2, z1], [x0, (z0 + z1) / 2], [x1, (z0 + z1) / 2],
  ];
  for (const [x, z] of samples) {
    if (z > OCEAN.beachZ - 2) { out.push({ kind: 'ocean', id: `beach@${x},${z}` }); break; }
    if (!landCoveredAt(x, z)) { out.push({ kind: 'off-land', id: `gap@${x},${z}` }); break; }
    if (x < LAND_FILL.x0 + 2 || x > LAND_FILL.x1 - 2 || z < LAND_FILL.z0 + 2) { out.push({ kind: 'map-edge', id: `${x},${z}` }); break; }
  }
  for (const [x, z] of samples) {
    if (inRiver(x, z, 4) || inRiverLake(x, z) || inLake(x, z, 4)) { out.push({ kind: 'water', id: `${x},${z}` }); break; }
  }
  const lake: OBB = { x: LAKE.x, z: LAKE.z, w: LAKE.rx * 2 + 8, d: LAKE.rz * 2 + 8, rot: 0 };
  if (obbOverlap(box, lake, PAD)) out.push({ kind: 'water', id: 'lake-aabb' });

  for (const [id, v] of Object.entries(RESERVED_VENUES)) {
    const b: OBB = { x: (v.x0 + v.x1) / 2, z: (v.z0 + v.z1) / 2, w: v.x1 - v.x0, d: v.z1 - v.z0, rot: 0 };
    if (obbOverlap(box, b, PAD)) out.push({ kind: 'venue', id });
  }
  for (const [id, v] of [['airport', AIRPORT], ['racetrack', RACETRACK]] as const) {
    const b: OBB = { x: (v.x0 + v.x1) / 2, z: (v.z0 + v.z1) / 2, w: v.x1 - v.x0, d: v.z1 - v.z0, rot: 0 };
    if (obbOverlap(box, b, PAD)) out.push({ kind: 'venue', id: `${id}-venues` });
  }

  for (const [a, b, w] of mapRoadSegments()) {
    const c = roadClearance(box, a, b, w);
    if (c < PAD) out.push({ kind: 'road', id: `map:${a}–${b}`, dist: c });
  }
  for (const g of expRoadSegments()) {
    const c = roadClearance(box, g.a, g.b, g.w);
    if (c < PAD) out.push({ kind: 'road', id: `exp:${g.id}`, dist: c });
  }

  for (const [id, b] of Object.entries(landmarks())) {
    if (id === SPACE_CENTER_ID) continue;
    if (obbOverlap(box, b, PAD)) out.push({ kind: 'landmark', id });
  }
  for (const [id, s] of Object.entries(MINE_SITES)) {
    const b: OBB = { x: s.x, z: s.z, w: MINE_APRON, d: MINE_APRON, rot: 0 };
    if (obbOverlap(box, b, PAD)) out.push({ kind: 'mine', id });
  }
  for (const p of properties()) {
    if (p.map) continue;
    if (p.type === SPACE_CENTER_ID || p.id === `lm:${SPACE_CENTER_ID}`) continue;
    if (obbOverlap(box, p, PAD)) out.push({ kind: 'property', id: p.id });
  }
  for (const p of expansionPlotFootprints()) {
    if (p.id === SPACE_CENTER_ID) continue;
    if (obbOverlap(box, p, PAD)) out.push({ kind: 'expansion-plot', id: p.id });
  }
  {
    const j: OBB = { x: JAIL_SITE.x, z: JAIL_SITE.z, w: (JAIL_SITE.w + 4) * JAIL_SCALE, d: (JAIL_SITE.d + 4) * JAIL_SCALE, rot: JAIL_SITE.rot };
    if (obbOverlap(box, j, PAD)) out.push({ kind: 'jail', id: 'jail' });
  }
  {
    const green: OBB = { x: GOLDWOOD_GREEN.x, z: GOLDWOOD_GREEN.z, w: GOLDWOOD_GREEN.rx * 2, d: GOLDWOOD_GREEN.rz * 2, rot: 0 };
    if (obbOverlap(box, green, PAD)) out.push({ kind: 'goldwood', id: 'green' });
    const pond: OBB = { x: GOLDWOOD_POND.x, z: GOLDWOOD_POND.z, w: GOLDWOOD_POND.rx * 2, d: GOLDWOOD_POND.rz * 2, rot: 0 };
    if (obbOverlap(box, pond, PAD)) out.push({ kind: 'goldwood', id: 'pond' });
    for (const [i, g] of GOLDWOOD_GATES.entries()) {
      const gb: OBB = { x: g.x, z: g.z, w: 22, d: 16, rot: -g.ang };
      if (obbOverlap(box, gb, PAD)) out.push({ kind: 'goldwood', id: `gate-${i}` });
    }
    const gw: OBB = { x: (GOLDWOOD.x0 + GOLDWOOD.x1) / 2, z: (GOLDWOOD.z0 + GOLDWOOD.z1) / 2, w: GOLDWOOD.x1 - GOLDWOOD.x0, d: GOLDWOOD.z1 - GOLDWOOD.z0, rot: 0 };
    if (obbOverlap(box, gw, PAD)) out.push({ kind: 'goldwood', id: 'community' });
  }
  return out;
}

describe('space center placement', () => {
  const box: OBB = { ...SPACE_CENTER };

  it('sits in the top-left (NW) corner, west of Goldwood, fully on land, at the published scale', () => {
    expect(SPACE_CENTER.x).toBe(-216);
    expect(SPACE_CENTER.z).toBe(-409);
    expect(SPACE_CENTER.w).toBeGreaterThanOrEqual(SPACE_CENTER_SIZE.w);
    expect(SPACE_CENTER.d).toBeGreaterThanOrEqual(SPACE_CENTER_SIZE.d);
    expect(SPACE_CENTER.x).toBeLessThan(GOLDWOOD.x0);
    expect(SPACE_CENTER.z).toBeLessThan(-250); // north of the Speedway / outskirts
    const x0 = box.x - box.w / 2, x1 = box.x + box.w / 2, z0 = box.z - box.d / 2, z1 = box.z + box.d / 2;
    const samples: [number, number][] = [
      [x0, z0], [x1, z0], [x0, z1], [x1, z1], [box.x, box.z],
    ];
    for (const [x, z] of samples) {
      expect(landCoveredAt(x, z), `land at ${x},${z}`).toBe(true);
      expect(z).toBeLessThan(OCEAN.beachZ - 2);
    }
  });

  it('does not overlap roads, lots, buildings, farms, water, venues, mines, the jail, or Goldwood', () => {
    const hits = spaceCenterOverlapHits(box);
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });

  it('keeps a generous clearance to the nearest road and to Goldwood', () => {
    let best = Infinity, id = '';
    for (const [a, b, w] of mapRoadSegments()) {
      const c = roadClearance(box, a, b, w);
      if (c < best) { best = c; id = `map:${a}–${b}`; }
    }
    for (const g of expRoadSegments()) {
      const c = roadClearance(box, g.a, g.b, g.w);
      if (c < best) { best = c; id = `exp:${g.id}`; }
    }
    expect(best, id).toBeGreaterThanOrEqual(20);
    expect(GOLDWOOD.x0 - (box.x + box.w / 2)).toBeGreaterThanOrEqual(20);
  });

  it('clears trees only inside the campus footprint', () => {
    const x0 = box.x - box.w / 2, x1 = box.x + box.w / 2, z0 = box.z - box.d / 2, z1 = box.z + box.d / 2;
    const inYard = (x: number, z: number, r = 2) => x >= x0 - r && x <= x1 + r && z >= z0 - r && z <= z1 + r;
    const trees = expansionScenery().filter((s) => (s.kind === 'deciduous' || s.kind === 'pine' || s.kind === 'bush') && inYard(s.x, s.z, 2));
    expect(trees, trees.map((s) => `${s.kind}@${s.x.toFixed(1)},${s.z.toFixed(1)}`).join(', ')).toHaveLength(0);
    // Trees still stand in the surrounding NW countryside (cleared only in-footprint).
    const nearby = expansionScenery().filter((s) => (s.kind === 'deciduous' || s.kind === 'pine') && !inYard(s.x, s.z, 2)
      && s.x >= x0 - 80 && s.x <= x1 + 80 && s.z >= z0 - 80 && s.z <= z1 + 80);
    expect(nearby.length).toBeGreaterThan(20);
  });

  it('is wired as a late, square, non-deed landmark with a 2D map marker and a space-program panel', () => {
    expect(LANDMARK_IDS).toContain(SPACE_CENTER_ID);
    expect(LANDMARK_SLOTS[SPACE_CENTER_ID]).toEqual([SPACE_CENTER.x, SPACE_CENTER.z]);
    const lm = landmarks()[SPACE_CENTER_ID];
    expect(lm).toMatchObject({ x: SPACE_CENTER.x, z: SPACE_CENTER.z, w: SPACE_CENTER.w, d: SPACE_CENTER.d, rot: 0 });
    expect(properties().some((p) => p.type === SPACE_CENTER_ID || p.id === `lm:${SPACE_CENTER_ID}`)).toBe(false);
    expect(WORLD_SPOTS.some((s) => s.id === SPACE_CENTER_ID && s.label === 'Space Center')).toBe(true);

    const world = src('client/src/lib/world3d.ts');
    expect(world).toMatch(/buildSpaceCenter\(\)/);
    expect(world).toMatch(/campus\.position\.set\(-SPACE_CENTER_OX, 0, -SPACE_CENTER_OZ\)/);
    expect(world).not.toMatch(/case 'spacecenter':[\s\S]{0,400}setPanel/);
    expect(src('client/src/components/WorldMap.tsx')).toMatch(/case 'spacecenter'/);
    expect(src('client/src/components/WorldMap.tsx')).toMatch(/spacesim/);
    expect(src('shared/realEstate.ts')).toMatch(/'spacecenter'/);
    expect(SPACE_CENTER_OX).toBe(2);
    expect(SPACE_CENTER_OZ).toBe(1);
  });
});
