import { describe, it, expect } from 'vitest';
import { CAR_LOOPS, CAR_COUNT, LANE, loopPoint, landmarkBoxes, fillerSpots, fillerBoxes, ROADS_X, ROADS_Z, ROAD_W, SPOT_POS, type AABB } from '../client/src/lib/worldLayout';

const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const CAR_R = 0.9; // half car length — conservative radius
const hits = (b: AABB, x: number, z: number, m: number) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m;

describe('world layout', () => {
  const boxes = [...landmarkBoxes(), ...fillerBoxes(fillerSpots(rng(7)))];
  it('has fewer cars', () => { expect(CAR_COUNT).toBeLessThanOrEqual(9); expect(CAR_COUNT).toBeGreaterThanOrEqual(6); });
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
      for (const rx of ROADS_X) expect(b.x1 <= rx - ROAD_W / 2 || b.x0 >= rx + ROAD_W / 2 || b.z0 > 33.5 || b.z1 < -33.5).toBe(true);
      for (const rz of ROADS_Z) expect(b.z1 <= rz - ROAD_W / 2 || b.z0 >= rz + ROAD_W / 2).toBe(true);
    }
    const p = Object.values(SPOT_POS);
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) expect(Math.max(Math.abs(p[i][0] - p[j][0]), Math.abs(p[i][1] - p[j][1]))).toBeGreaterThanOrEqual(20);
  });
});
