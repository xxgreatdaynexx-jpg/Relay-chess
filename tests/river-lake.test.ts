import { describe, it, expect } from 'vitest';
import { riverOutline, islandOutline, riverDecor, inRiverLake, inPoly, riverNorthZ, riverSouthZ } from '../shared/riverLake';
import { PLATE, shoreZ, ROADS } from '../shared/worldLayout';

describe('big lake (natural shoreline)', () => {
  it('stays off the city and inside the plate', () => {
    for (let x = -104; x <= 104; x += 0.5) { expect(riverNorthZ(x)).toBeGreaterThanOrEqual(shoreZ(x) - 1e-9); expect(riverSouthZ(x)).toBeLessThanOrEqual(PLATE - 2.5); expect(riverSouthZ(x)).toBeGreaterThanOrEqual(riverNorthZ(x) - 1e-9); }
    for (const [x, z] of riverOutline()) expect(Math.abs(x)).toBeLessThan(PLATE);
  });
  it('is not a slab: the south shore and the ends vary', () => {
    const s = Array.from({ length: 200 }, (_, i) => riverSouthZ(-100 + i) - shoreZ(-100 + i));
    expect(Math.max(...s) - Math.min(...s)).toBeGreaterThan(10);
    expect(inRiverLake(-110, shoreZ(-110) + 5)).toBe(false); expect(inRiverLake(110, shoreZ(110) + 5)).toBe(false);
  });
  it('has an island and keeps decor out of the water and the city', () => {
    const isl = islandOutline(); expect(isl.every(([x, z]) => inPoly(x, z, riverOutline()))).toBe(true);
    const d = riverDecor();
    for (const [x, z] of d.trees) { expect(inRiverLake(x, z)).toBe(false); expect(z > shoreZ(x) || inPoly(x, z, isl)).toBe(true); }
    expect(d.reeds.filter(([x, z]) => z < shoreZ(x) - 0.5).length).toBe(0);
    expect(d.trees.length).toBeGreaterThan(40);
  });
  it('no city road crosses open water', () => {
    for (const r of ROADS) for (const [x, z] of r.pts) expect(inRiverLake(x, z)).toBe(false);
  });
});
