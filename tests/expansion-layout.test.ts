import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BEACH_X0, BEACH_X1, EXISTING_GROUND, LAND_FILL, expansionLandBoxes, expansionRoadPlotOverlaps,
  expansionScenery, landCoveredAt, sceneryOverlaps, subtractRects,
} from '../shared/expansionScenery';
import { EAST_X1, GOLDWOOD } from '../shared/mapExpansion';
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
  it('stops Goldwood driveways in front of the north-row mansions', () => {
    const roads = src('shared/mapExpansion.ts');
    expect(roads).toMatch(/GOLDWOOD_NORTH_CURB_Z/);
    expect(roads).not.toMatch(/GOLDWOOD\.z0 \+ 16/);
  });
});

describe('expansion scenery', () => {
  it('is deterministic, varied, and never on roads, lots, farms, runways or buildings', () => {
    const a = expansionScenery();
    const b = expansionScenery();
    expect(a).toEqual(b);
    const kinds = new Set(a.map((s) => s.kind));
    for (const k of ['pine', 'deciduous', 'bush', 'rock', 'lamp', 'pond', 'hedge', 'fence'] as const) {
      expect(kinds.has(k), k).toBe(true);
    }
    expect(a.length).toBeGreaterThan(400);
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
