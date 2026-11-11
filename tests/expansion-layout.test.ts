import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BEACH_X0, BEACH_X1, EXISTING_GROUND, LAND_FILL, expansionLandBoxes, expansionRoadPlotOverlaps,
  expansionScenery, landCoveredAt, riverPlotOverlaps, sceneryOverlaps, subtractRects,
} from '../shared/expansionScenery';
import { EAST_X1, GOLDWOOD, GOLDWOOD_SETBACK, goldwoodHomes, inExpansion } from '../shared/mapExpansion';
import { EXP_BRIDGES, EXP_CUL_ENDS, EXP_JUNCTIONS, EXP_ROADS, expRoadClearance } from '../shared/expansionRoads';
import { RIVER_PTS, riverClearance, riverCrossings } from '../shared/expansionRiver';
import { haulNoRoadRoutes, haulSiteXZ, roadPath } from '../shared/haulVisual';
import { drivable } from '../shared/venues';
import { OCEAN } from '../shared/ocean';
import { AIRPORT } from '../shared/venues';
import { xmasOn } from '../shared/holiday';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('expanded map land fill', () => {
  it('covers every land sample of the 2x map (no sky gaps) down to the beach', () => {
    const boxes = expansionLandBoxes();
    expect(boxes.length).toBeGreaterThan(4);
    let n = 0;
    for (let x = LAND_FILL.x0 + 3; x < LAND_FILL.x1 - 3; x += 10) {
      for (let z = LAND_FILL.z0 + 3; z < OCEAN.beachZ - 3; z += 10) {
        n++;
        expect(landCoveredAt(x, z), `gap at ${x},${z}`).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(1000);
    // new slabs do not overlap the interiors of existing city / outskirts / venue ground
    for (const a of boxes) for (const b of EXISTING_GROUND) {
      const ix0 = Math.max(a.x0, b.x0), ix1 = Math.min(a.x1, b.x1);
      const iz0 = Math.max(a.z0, b.z0), iz1 = Math.min(a.z1, b.z1);
      expect(ix1 - ix0 < 0.05 || iz1 - iz0 < 0.05, `new land overlaps existing ${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(true);
    }
  });

  it('does not paint ground over the ocean', () => {
    for (const b of expansionLandBoxes()) expect(b.z1).toBeLessThanOrEqual(OCEAN.beachZ + 1e-6);
    expect(landCoveredAt(0, OCEAN.beachZ + 20)).toBe(true); // treated as ocean (not a land gap)
  });

  it('subtractRects leaves a complementary tiling', () => {
    const parts = subtractRects({ x0: 0, x1: 10, z0: 0, z1: 10 }, [{ x0: 3, x1: 6, z0: 3, z1: 6 }]);
    expect(parts.some((p) => p.x0 === 0 && p.x1 === 3)).toBe(true);
  });
});

describe('expanded map beach', () => {
  it('runs from west of the airport to east of East Estates', () => {
    expect(BEACH_X0).toBeLessThanOrEqual(AIRPORT.x0 - 10);
    expect(BEACH_X1).toBeGreaterThanOrEqual(EAST_X1 + 20);
    const world = src('client/src/lib/world3d.ts');
    expect(world).toMatch(/buildBeach\(BEACH_X0,\s*BEACH_X1/);
  });
});

describe('expansion roads vs plots', () => {
  it('keeps spine roads, driveways and orchard roads off lots, farms, wineries, orchards and mansions', () => {
    expect(expansionRoadPlotOverlaps()).toEqual([]);
  });
  it('lays Goldwood out as a curved loop with homes facing the street, not a straight grid', () => {
    const gw = EXP_ROADS.find((r) => r.id === 'gw-circle')!;
    expect(gw.closed).toBe(true);
    for (const h of goldwoodHomes()) {
      // the house front (local +z) points at the loop road
      const fx = h.x + Math.sin(h.rot) * (GOLDWOOD_SETBACK + 2), fz = h.z + Math.cos(h.rot) * (GOLDWOOD_SETBACK + 2);
      expect(expRoadClearance(fx, fz), `home ${h.n}`).toBeLessThan(3);
    }
    expect(src('shared/mapExpansion.ts')).not.toMatch(/GOLDWOOD\.z0 \+ 16/);
  });
});

describe('expansion road network', () => {
  it('has no floating segments: every open end meets another road, a tie-in, or a cul-de-sac', () => {
    for (const r of EXP_ROADS) for (const e of r.ends) expect(['junction', 'cul'], `${r.id} ${e}`).toContain(e);
    const culs = EXP_ROADS.flatMap((r) => r.ends.filter((e) => e === 'cul')).length;
    expect(EXP_CUL_ENDS.length).toBe(culs);
    expect(EXP_JUNCTIONS.length).toBeGreaterThan(8);
  });
  it('bridges every place a road crosses the river', () => {
    expect(EXP_BRIDGES.length).toBeGreaterThanOrEqual(3);
    for (const r of EXP_ROADS) for (let i = 1; i < r.pts.length; i++) for (const c of riverCrossings(r.pts[i - 1], r.pts[i])) {
      expect(EXP_BRIDGES.some((b) => b.road === r.id && Math.hypot(b.x - c.x, b.z - c.z) < b.len), `${r.id} @ ${c.x},${c.z}`).toBe(true);
    }
  });
  it('routes haul trucks from the city across a river bridge to the far-east farms', () => {
    const before = haulNoRoadRoutes.length;
    const to = haulSiteXZ('cf:2004')!; expect(to).not.toBeNull();
    const path = roadPath(haulSiteXZ('warehouse')!, to);
    expect(haulNoRoadRoutes.length).toBe(before);
    expect(path.length).toBeGreaterThan(10);
    // it crosses the river, and only where there is a bridge
    let crossed = false;
    for (let i = 1; i < path.length; i++) for (const c of riverCrossings(path[i - 1], path[i])) {
      crossed = true; expect(EXP_BRIDGES.some((b) => Math.hypot(b.x - c.x, b.z - c.z) < b.len), `ford at ${c.x},${c.z}`).toBe(true);
    }
    expect(crossed).toBe(true);
  });
  it('lets cars drive over bridges but not through the river', () => {
    for (const b of EXP_BRIDGES) expect(drivable(b.x, b.z), `bridge ${b.road}`).toBe(true);
    const mid = RIVER_PTS[Math.floor(RIVER_PTS.length * 0.45)];
    if (inExpansion(mid[0], mid[1]) && !EXP_BRIDGES.some((b) => Math.hypot(b.x - mid[0], b.z - mid[1]) < 30)) expect(drivable(mid[0], mid[1])).toBe(false);
  });
  it('keeps every plot, farm, winery and mansion ground out of the river', () => {
    expect(riverPlotOverlaps()).toEqual([]);
  });
});

describe('expansion scenery', () => {
  it('is deterministic, varied, and never on roads, lots, farms, runways or buildings', () => {
    const a = expansionScenery();
    const b = expansionScenery();
    expect(a).toEqual(b);
    const kinds = new Set(a.map((s) => s.kind));
    for (const k of ['pine', 'deciduous', 'bush', 'rock', 'lamp', 'pond', 'hedge', 'fence', 'reed'] as const) {
      expect(kinds.has(k), k).toBe(true);
    }
    expect(a.length).toBeGreaterThan(4000);
    // real forest cover: thousands of trees, none in the river or on a road
    const trees = a.filter((t) => t.kind === 'pine' || t.kind === 'deciduous');
    expect(trees.length).toBeGreaterThan(3000);
    for (const t of trees) { expect(riverClearance(t.x, t.z), `tree in river ${t.x},${t.z}`).toBeGreaterThan(0.8); expect(expRoadClearance(t.x, t.z), `tree on road ${t.x},${t.z}`).toBeGreaterThan(0.8); }
    expect(sceneryOverlaps(a)).toEqual([]);
    // hedges ring the Goldwood community
    expect(a.some((s) => s.kind === 'hedge' && s.x > GOLDWOOD.x0 && s.x < GOLDWOOD.x1 && s.z > GOLDWOOD.z0 && s.z < GOLDWOOD.z1)).toBe(true);
  });

  it('paints the new land with the same seasonal snow ground the city uses', () => {
    const world = src('client/src/lib/world3d.ts');
    expect(world).toMatch(/expansionLandBoxes/);
    expect(world).toMatch(/xmasGround/);
    expect(typeof xmasOn()).toBe('boolean');
  });
});
