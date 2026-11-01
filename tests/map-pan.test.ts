import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAP_BOUNDS, clampMapTarget, farmPlots, FARM_X1 } from '../shared/farm';
import { PARK_AREA, PLATE } from '../shared/worldLayout';

describe('map panning', () => {
  it('bounds cover the plate, the trailer park and the farm district', () => {
    expect(MAP_BOUNDS.x1).toBeGreaterThanOrEqual(FARM_X1);
    for (const p of farmPlots()) expect(clampMapTarget(p.x, p.z)).toEqual([p.x, p.z]);
    expect(clampMapTarget(PARK_AREA.x, PARK_AREA.z)).toEqual([PARK_AREA.x, PARK_AREA.z]);
    expect(clampMapTarget(-PLATE, PLATE)).toEqual([-PLATE, PLATE]);
  });
  it('clamps targets off the map', () => {
    expect(clampMapTarget(9999, -9999)).toEqual([MAP_BOUNDS.x1, MAP_BOUNDS.z0]);
    expect(clampMapTarget(-9999, 9999)).toEqual([MAP_BOUNDS.x0, MAP_BOUNDS.z1]);
  });
  it('world3d wires drag pan, keys (not while typing/driving) and the clamp', () => {
    const src = readFileSync(new URL('../client/src/lib/world3d.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/LEFT: THREE\.MOUSE\.PAN/); expect(src).toMatch(/ONE: THREE\.TOUCH\.PAN/);
    expect(src).toMatch(/typing\(\) \|\| !controls\.enabled/); expect(src).toMatch(/clampPan\(\)/);
    expect(src).toMatch(/if \(moved > 8\) return/);
  });
});
