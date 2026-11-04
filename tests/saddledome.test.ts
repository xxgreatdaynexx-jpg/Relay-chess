import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildStadium, DOME, rimY } from '../client/src/lib/worldStadium';

const tris = (g: THREE.Object3D) => { let n = 0; g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const geo = m.geometry; n += (geo.index ? geo.index.count : geo.attributes.position!.count) / 3; } }); return n; };
const STAGES: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [2, 0.5], [3, 0], [4, 0]]; // 0 / 25 / 50 / 62 / 75 / 100 %

describe('Saddledome stadium model', () => {
  it('saddle rim: high at the ends, dipping at the sides (hypar)', () => {
    expect(rimY(0)).toBeCloseTo(DOME.H + DOME.K); expect(rimY(Math.PI)).toBeCloseTo(DOME.H + DOME.K);
    expect(rimY(Math.PI / 2)).toBeCloseTo(DOME.H - DOME.K); expect(rimY(0, 0)).toBe(DOME.H);
  });
  it('every stage builds more of the shape', () => {
    let prev = -1; for (const [d, f] of STAGES) { const n = buildStadium(d, f).children.length; expect(n).toBeGreaterThan(prev); prev = n; }
  });
  it('finished roof is a saddle (ends above sides) and the bowl sits under it', () => {
    const g = buildStadium(4, 0); let maxEnd = -Infinity, maxSide = -Infinity;
    const m = g.getObjectByName('saddle-roof') as THREE.Mesh; expect(m).toBeTruthy();
    const p = m.geometry.attributes.position!; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), y = p.getY(i); if (Math.abs(z) < 1) maxEnd = Math.max(maxEnd, y); if (Math.abs(x) < 1) maxSide = Math.max(maxSide, y); }
    expect(maxEnd).toBeGreaterThan(maxSide + 2);
  });
  it('low-gfx path is lighter and has no transparent materials', () => {
    const hi = buildStadium(4, 0), lo = buildStadium(4, 0, true); expect(tris(lo)).toBeLessThan(tris(hi));
    lo.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && !Array.isArray(m)) expect(m.transparent).toBe(false); });
    expect(tris(hi)).toBeLessThan(40_000); // map budget
  });
});

describe('Saddledome geometry is valid', () => {
  it('no NaN attributes or out-of-range indices at any stage / gfx tier', () => {
    for (const low of [false, true]) for (const [d, f] of STAGES) buildStadium(d, f, low).traverse((o) => { const geo = (o as THREE.Mesh).geometry; if (!geo) return;
      for (const a of Object.values(geo.attributes)) for (const v of Array.from(a.array as ArrayLike<number>)) expect(Number.isFinite(v)).toBe(true);
      if (geo.index) { const n = geo.attributes.position!.count; for (const v of geo.index.array) expect(v).toBeLessThan(n); } });
  });
});
