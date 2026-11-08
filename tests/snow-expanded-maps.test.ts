// Dayne 2026-11-07 19:37 UTC-6: snow on the expanded maps — snowfall box edge, missing road slush, ground seams.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { xmasGroundOffset, snowVolume } from '../client/src/lib/worldXmas';
import { RURAL_ROADS } from '../shared/outskirts';
import { BIG_ROADS } from '../shared/bigFarms';
import { AIRPORT_ROADS, RACETRACK_ROADS } from '../shared/venues';
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const frac = (a: number) => a - Math.floor(a);
describe('snow on expanded maps', () => {
  it('ground texture is world-phased: the pattern is continuous across adjacent pieces', () => {
    // world uv at x: u*repeat + offset = (x - x0)/44 + frac(x0/44) ≡ x/44 (mod 1), for any piece origin
    for (const [x0, w, z1, d] of [[-222, 106, -116, 102], [-116, 232, 116, 232], [208, 300, 192, 410]]) {
      const o = xmasGroundOffset(x0, z1);
      for (const t of [0, 0.37, 1]) { const x = x0 + t * w, z = z1 - t * d;
        expect(frac((x - x0) / 44 + o.x)).toBeCloseTo(frac(x / 44), 6);
        expect(frac((z1 - z) / 44 + o.y)).toBeCloseTo(frac(-z / 44), 6); }
    }
  });
  it('every ground top passes its world origin', () => {
    const w = src('client/src/lib/world3d.ts'); const v = src('client/src/lib/worldVenues.ts');
    expect([...w.matchAll(/xmasGround\(([^)]*)\)/g)].map((m) => m[1].split(',').length)).toEqual([5, 5, 5]);
    expect(v).toMatch(/xmasGround\([^)]*r\.x0, r\.z1\)/);
  });
  it('snowfall volume covers the camera and target at every zoom and pan, including far corners; never culled', () => {
    const base = 166; // PLATE + 50
    for (const dist of [30, 120, 240, 360]) for (const pol of [0.35, 0.8, 1.2]) for (const az of [0, 1, 2.5, 4]) for (const [tx, tz] of [[0, 0], [-222, -218], [208, 192], [520, 0]]) {
      const h = Math.sin(pol) * dist; const cam = { x: tx + Math.sin(az) * h, y: Math.cos(pol) * dist, z: tz + Math.cos(az) * h };
      const v = snowVolume(cam, { x: tx, y: 0, z: tz }, base); const inside = (x: number, z: number, k: number) => Math.max(Math.abs(x - v.cx), Math.abs(z - v.cz)) <= k * v.half;
      expect(inside(tx, tz, 0.75)).toBe(true); // target in the fully dense core
      expect(inside(cam.x, cam.z, 0.75)).toBe(true); // camera too
      expect(v.half).toBeLessThanOrEqual(0.85 * 360 + 1e-9);
    }
    const x = src('client/src/lib/worldXmas.ts');
    expect(x).toContain('pts.frustumCulled = false');
    expect(x).toContain('const n = SNOW_COUNT[o.tier]');
    expect(src('client/src/lib/world3d.ts')).toContain('xmas?.step(dt, camera.position, controls.target)');
  });
  it('newer road sets get the city road slush decal', () => {
    expect(RURAL_ROADS.length + BIG_ROADS.length + AIRPORT_ROADS.length + RACETRACK_ROADS.length).toBeGreaterThan(0);
    expect(src('client/src/lib/world3d.ts')).toMatch(/allRoads\.forEach[\s\S]{0,700}xmas\.addRoads\(\[rg\]\)/);
  });
});
