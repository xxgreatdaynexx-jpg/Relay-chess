import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { FORT_SPOTS, FORT_X0, FORT_X1, FORT_YARDS, FORT_Z0, FORT_Z1, TRACTS, YARD_D, YARD_W, plantOwnerOffset, tractInfo } from '../shared/fortmc';
import { FORT_WATERS, MINE_PIT, fortHeight } from '../shared/fortmcLand';
import { FORTMC_LEASE_RANGE_MIGRATION, FORTMC_MIGRATION } from '../server/fortmc';

const overlap = (a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
const src = readFileSync(new URL('../client/src/lib/fortmc3d.ts', import.meta.url), 'utf8');

describe('Fort McChud map expansion', () => {
  it('doubles the map area and keeps the original east field where it was', () => {
    expect((FORT_X1 - FORT_X0) * (FORT_Z1 - FORT_Z0)).toBe(2 * 280 * 210);
    expect([FORT_X1, FORT_Z0, FORT_Z1]).toEqual([140, -110, 100]);
    expect(TRACTS).toBe(20);
    for (let n = 1; n <= 10; n++) { const t = tractInfo(n); expect([t.x, t.z]).toEqual([-110 + ((n - 1) % 5) * 44, -80 + Math.floor((n - 1) / 5) * 40]); }
    expect(tractInfo(1).name).toBe('Athabasca Flats'); expect(tractInfo(10).name).toBe('Peace Point');
    expect(new Set(Array.from({ length: TRACTS }, (_, i) => tractInfo(i + 1).name)).size).toBe(TRACTS);
  });
  it('every tract, yard and landmark sits inside the map and nothing overlaps', () => {
    const boxes = [
      ...Array.from({ length: TRACTS }, (_, i) => { const t = tractInfo(i + 1); return { id: `t${t.n}`, x: t.x, z: t.z, w: 30, d: 26 }; }),
      ...FORT_YARDS.map((y, i) => ({ id: `y${i}`, x: y.x, z: y.z, w: YARD_W, d: YARD_D })),
      ...FORT_SPOTS.map((s) => ({ id: s.id, x: s.x, z: s.z, w: s.w, d: s.d })),
    ];
    for (const b of boxes) { expect(b.x - b.w / 2).toBeGreaterThanOrEqual(FORT_X0); expect(b.x + b.w / 2).toBeLessThanOrEqual(FORT_X1); expect(b.z - b.d / 2).toBeGreaterThanOrEqual(FORT_Z0); expect(b.z + b.d / 2).toBeLessThanOrEqual(FORT_Z1); }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!), `${boxes[i]!.id} vs ${boxes[j]!.id}`).toBe(false);
  });
  it('other operators get their own yard instead of being stacked over the airport', () => {
    expect(plantOwnerOffset(0)).toEqual({ x: 0, z: 0 });
    const seen = new Set<string>(); for (let i = 1; i <= FORT_YARDS.length; i++) { const o = plantOwnerOffset(i); seen.add(`${o.x},${o.z}`); expect(o.x).toBeLessThan(-140); }
    expect(seen.size).toBe(FORT_YARDS.length);
  });
  it('the play area is flat; the mine pit and ponds are carved into it', () => {
    for (let n = 1; n <= TRACTS; n++) { const t = tractInfo(n); for (const [dx, dz] of [[0, 0], [15, 13], [-15, -13]]) expect(fortHeight(t.x + dx, t.z + dz)).toBe(0); }
    for (const s of FORT_SPOTS) if (s.id !== 'f-mine') expect(fortHeight(s.x, s.z)).toBe(0);
    expect(fortHeight(MINE_PIT.x, MINE_PIT.z)).toBeLessThan(-MINE_PIT.depth);
    for (const w of FORT_WATERS) expect(fortHeight(w.x, w.z)).toBeLessThan(-1);
    expect(fortHeight(FORT_X0 - 200, 0)).toBeGreaterThan(2); // hills past the edge
  });
  it('draws every built process unit up to its cap (refineries 5-9 used to be hidden)', () => {
    expect(src).toMatch(/Math\.min\(UNITS\[k\]\.max, count\(k\)\)/);
    expect(src).not.toMatch(/Math\.min\(4, count\(k\)\)/);
  });
  it('widens the lease table check so tracts 11-20 can be leased, without touching rows', async () => {
    const db = new PGlite(); await db.exec(FORTMC_MIGRATION); await db.exec(FORTMC_LEASE_RANGE_MIGRATION);
    await db.query('INSERT INTO fortmc_leases (tract, player_key, name, leased_at) VALUES (3, $1, $2, 1)', ['a', 'A']);
    await db.exec(FORTMC_MIGRATION); await db.exec(FORTMC_LEASE_RANGE_MIGRATION); // idempotent on reboot
    await db.query('INSERT INTO fortmc_leases (tract, player_key, name, leased_at) VALUES (17, $1, $2, 1)', ['b', 'B']);
    await expect(db.query('INSERT INTO fortmc_leases (tract, player_key, name, leased_at) VALUES (21, $1, $2, 1)', ['c', 'C'])).rejects.toThrow();
    expect((await db.query('SELECT tract FROM fortmc_leases ORDER BY tract')).rows).toEqual([{ tract: 3 }, { tract: 17 }]);
  });
});
