import { describe, it, expect } from 'vitest';
import { CAR_LOOPS, CAR_COUNT, LANE, loopPoint, landmarkBoxes, fillerSpots, fillerBoxes, ROADS_X, ROADS_Z, ROAD_W, SPOT_POS, ROAD_X_SPAN, PLATE, NBX, NBZ, cityBlocks, type AABB } from '../client/src/lib/worldLayout';

const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const CAR_R = 0.9; // half car length — conservative radius
const hits = (b: AABB, x: number, z: number, m: number) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m;

describe('world layout', () => {
  const boxes = [...landmarkBoxes(), ...fillerBoxes(fillerSpots(rng(7)))];
  it('is a big city with modest traffic (cars scale with the network, not per block)', () => {
    expect(PLATE).toBeGreaterThanOrEqual(85); expect(NBX * NBZ).toBeGreaterThanOrEqual(50);
    expect(CAR_COUNT).toBeLessThanOrEqual(Math.ceil((NBX * NBZ) / 3)); expect(CAR_COUNT).toBeGreaterThanOrEqual(8);
  });
  it('fills empty blocks with varied housing, parks, plazas and lots', () => {
    const kinds = new Set(cityBlocks(rng(7)).map((b) => b.kind)); for (const k of ['landmark', 'housing', 'park', 'lot']) expect(kinds.has(k as never)).toBe(true);
    const types = new Set(fillerSpots(rng(7)).map((h) => h.type)); expect(types.size).toBeGreaterThanOrEqual(4);
    const f = fillerBoxes(fillerSpots(rng(7)));
    for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) { const a = f[i], b = f[j]; expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.z1 <= b.z0 || b.z1 <= a.z0).toBe(true); }
  });
  it('car paths never intersect a building footprint and stay on a road', () => {
    for (const l of CAR_LOOPS) for (const lane of [LANE, -LANE]) for (let i = 0; i < 2000; i++) {
      const [x, z] = loopPoint(l, i / 2000, lane);
      for (const b of boxes) expect(hits(b, x, z, CAR_R), `car at ${x.toFixed(1)},${z.toFixed(1)}`).toBe(false);
      const onRoad = ROADS_X.some((rx) => Math.abs(rx - x) + 0.45 <= ROAD_W / 2) || ROADS_Z.some((rz) => Math.abs(rz - z) + 0.45 <= ROAD_W / 2);
      expect(onRoad).toBe(true);
    }
  });
  it('buildings never sit on roads and landmarks have readable gaps', () => {
    for (const b of boxes) {
      for (const rx of ROADS_X) expect(b.x1 <= rx - ROAD_W / 2 || b.x0 >= rx + ROAD_W / 2 || b.z0 > ROAD_X_SPAN[1] || b.z1 < ROAD_X_SPAN[0]).toBe(true);
      for (const rz of ROADS_Z) expect(b.z1 <= rz - ROAD_W / 2 || b.z0 >= rz + ROAD_W / 2).toBe(true);
    }
    const p = Object.values(SPOT_POS);
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) expect(Math.max(Math.abs(p[i][0] - p[j][0]), Math.abs(p[i][1] - p[j][1]))).toBeGreaterThanOrEqual(42);
  });
});
