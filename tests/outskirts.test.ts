import { describe, it, expect } from 'vitest';
import { outskirts, keepOut, RURAL_ROADS } from '../shared/outskirts';
import { RESERVED_VENUES, MINE_SITES, MINE_APRON, OUTSKIRTS, PLATE } from '../shared/worldLayout';
import { MAP_BOUNDS } from '../shared/farm';

const inR = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
describe('outskirts countryside', () => {
  const O = outskirts();
  it('fills the space with plenty of decor', () => {
    expect(O.trees.length).toBeGreaterThan(400); expect(O.fields.length).toBeGreaterThan(15); expect(O.buildings.length).toBeGreaterThan(20); expect(O.pumps.length).toBe(3);
  });
  it('keeps the airport and speedway spaces, plate and mines clear', () => {
    const pts: Array<[number, number]> = [...O.trees.map(([x, z]) => [x, z] as [number, number]), ...O.buildings.map((b) => [b.x, b.z] as [number, number]), ...O.fields.map((f) => [f.x, f.z] as [number, number]), ...O.lamps];
    for (const [x, z] of pts) {
      for (const r of Object.values(RESERVED_VENUES)) expect(inR(r, x, z)).toBe(false);
      expect(Math.abs(x) < PLATE && Math.abs(z) < PLATE).toBe(false);
      for (const s of Object.values(MINE_SITES)) expect(Math.abs(x - s.x) < MINE_APRON / 2 && Math.abs(z - s.z) < MINE_APRON / 2).toBe(false);
    }
    for (const b of [...O.buildings, ...O.fields]) expect(keepOut(b.x, b.z)).toBe(false);
  });
  it('reserved venue areas are big enough and do not overlap mines', () => {
    const a = RESERVED_VENUES.airport, t = RESERVED_VENUES.racetrack;
    expect(a.z1 - a.z0).toBeGreaterThan(140); expect(t.x1 - t.x0).toBeGreaterThan(140); expect(t.z1 - t.z0).toBeGreaterThan(80);
    for (const s of Object.values(MINE_SITES)) for (const r of [a, t]) expect(inR({ x0: r.x0 - MINE_APRON / 2, x1: r.x1 + MINE_APRON / 2, z0: r.z0 - MINE_APRON / 2, z1: r.z1 + MINE_APRON / 2 }, s.x, s.z)).toBe(false);
  });
  it('rural roads are axis-aligned or short connectors and stay in the outskirts, pan covers it', () => {
    for (const [a, b] of RURAL_ROADS) { expect(a[0] === b[0] || a[1] === b[1]).toBe(true); for (const p of [a, b]) expect(inR(OUTSKIRTS, p[0], p[1])).toBe(true); }
    expect(MAP_BOUNDS.x0).toBeLessThanOrEqual(OUTSKIRTS.x0 + 10); expect(MAP_BOUNDS.z1).toBeGreaterThanOrEqual(OUTSKIRTS.z1 - 10);
  });
});

import { properties, propertyById, sellBackOf, taxOf } from '../shared/realEstate';
import { countryHomes, countryBusinesses, lakeShape, LAKE } from '../shared/outskirts';
describe('countryside real estate', () => {
  it('country homes and businesses are buyable with unique, stable ids', () => {
    const ps = properties(); expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length);
    const homes = countryHomes(); expect(homes.length).toBeGreaterThan(30);
    for (const h of homes) { const p = propertyById(`b:house:${Math.round(h.x * 10)}:${Math.round(h.z * 10)}`)!; expect(p.label).toBe('Detached home'); expect(p.price).toBeGreaterThanOrEqual(10_000); expect(p.price).toBeLessThanOrEqual(30_000); /* housing reprice: 10k per employee slot */ expect(sellBackOf(p.price)).toBe(Math.floor(p.price * 0.7)); expect(taxOf(p.price)).toBeGreaterThan(0); }
    const biz = ps.filter((p) => p.type === 'gas' || p.type === 'depot'); expect(biz.length).toBe(countryBusinesses().length); expect(biz.length).toBeGreaterThanOrEqual(5);
  });
  it('lake outline stays inside its keep-out ellipse', () => {
    for (const [x, z] of lakeShape()) expect(((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2).toBeLessThan(1);
  });
});
