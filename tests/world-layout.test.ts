import { describe, it, expect } from 'vitest';
import { CAR_ROUTES, CAR_COUNT, LANE, routePoint, landmarks, landmarkBoxes, cityFill, ROADS, CUL_R, PLATE, LANDMARK_IDS, roadClearance, obbHit, obbOverlap, shoreZ, district } from '../client/src/lib/worldLayout';
import { WORLD_SPOTS } from '../client/src/lib/worldSpots';

const CAR_R = 0.9; // half car length — conservative radius

describe('world layout (organic city)', () => {
  const { houses, patches } = cityFill(7);
  const lms = landmarkBoxes();
  const solids = [...lms, ...houses, ...patches];
  it('is a big organic city with modest traffic', () => {
    expect(PLATE).toBeGreaterThanOrEqual(88);
    expect(houses.length).toBeGreaterThanOrEqual(200);
    expect(new Set(ROADS.map((r) => r.kind))).toEqual(new Set(['ring', 'boulevard', 'avenue', 'street', 'lane']));
    expect(ROADS.some((r) => r.cul)).toBe(true);
    expect(CAR_COUNT).toBeGreaterThanOrEqual(8); expect(CAR_COUNT).toBeLessThanOrEqual(16);
  });
  it('places every landmark (including reserved/new spots) with readable gaps', () => {
    const ids = [...new Set([...LANDMARK_IDS, ...WORLD_SPOTS.map((s) => s.id)])];
    const all = landmarks(ids);
    for (const id of ids) expect(all[id], id).toBeTruthy();
    const p = Object.values(landmarks());
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) expect(Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z)).toBeGreaterThanOrEqual(16);
  });
  it('fills the city with varied housing; downtown denser and taller than the suburbs', () => {
    expect(new Set(houses.map((h) => h.type)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(patches.map((p) => p.kind)).has('park')).toBe(true);
    const avg = (d: string) => { const l = houses.filter((h) => district(h.x, h.z) === d); return l.reduce((s, h) => s + h.h, 0) / l.length; };
    expect(avg('downtown')).toBeGreaterThan(avg('suburb'));
    for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) expect(obbOverlap(solids[i], solids[j]), `overlap ${i}/${j}`).toBe(false);
  });
  it('buildings never sit on roads or in the water, and face a street', () => {
    for (const r of ROADS) {
      const samples: [number, number, number][] = r.pts.map(([x, z]) => [x, z, r.width / 2]);
      if (r.cul) { const [x, z] = r.pts[r.pts.length - 1]; samples.push([x, z, CUL_R]); }
      for (const [x, z, hw] of samples) for (const b of solids) expect(obbHit(b, x, z, hw), `${r.id} through building at ${b.x.toFixed(1)},${b.z.toFixed(1)}`).toBe(false);
    }
    for (const b of solids) expect(b.z).toBeLessThan(shoreZ(b.x));
    for (const h of houses) expect(roadClearance(h.x, h.z, 40)).toBeLessThan(30);
  });
  it('cars follow the curved roads in-lane and never cross a building', () => {
    for (const route of CAR_ROUTES) for (let i = 0; i < 1500; i++) {
      const [x, z] = routePoint(route, i / 1500, LANE);
      expect(roadClearance(x, z), `${route.road.id} off-road at ${x.toFixed(1)},${z.toFixed(1)}`).toBeLessThanOrEqual(-0.45);
      for (const b of solids) if (Math.abs(b.x - x) < 14 && Math.abs(b.z - z) < 14) expect(obbHit(b, x, z, CAR_R), `car at ${x.toFixed(1)},${z.toFixed(1)}`).toBe(false);
    }
  });
});
