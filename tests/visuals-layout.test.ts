import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { layoutSnapshot } from './layoutSnapshot';
import { OCEAN } from '../shared/ocean';
import { MAP_BOUNDS, MAP_VIEW } from '../shared/farm';
import { HUB_MAPS } from '../shared/logistics';
import { outskirts } from '../shared/outskirts';

describe('mu-visuals ocean: existing seeded placement is untouched', () => {
  it('every lot / field / house / landmark id and position matches the d65b2b6 snapshot', () => {
    const base = JSON.parse(fs.readFileSync(new URL('./fixtures/layout-d65b2b6.json', import.meta.url), 'utf8'));
    const snap = JSON.parse(JSON.stringify(layoutSnapshot()));
    const next = new Set(['club', 'skytower', 'plastics', 'rigdock']);
    expect({ ...snap, landmarks: snap.landmarks.filter((row: [string]) => !next.has(row[0])) }).toEqual(base);
    const civic = Object.fromEntries(snap.landmarks.filter((row: [string]) => row[0] === 'club' || row[0] === 'skytower').map((row: [string, number, number, number]) => [row[0], row]));
    expect(civic.club.slice(0, 3)).toEqual(['club', -67, -10]);
    expect(civic.skytower.slice(0, 3)).toEqual(['skytower', 62, 36]);
    expect(snap.landmarks.some((row: [string]) => row[0] === 'plastics')).toBe(true);
    expect(snap.landmarks.some((row: [string]) => row[0] === 'rigdock')).toBe(true);
  });
  it('the ocean sits wholly outside the old map bounds and every old building', () => {
    expect(OCEAN.shoreZ).toBeGreaterThan(MAP_BOUNDS.z1);
    for (const b of outskirts().buildings) expect(b.z + b.d).toBeLessThan(OCEAN.beachZ);
    expect(MAP_VIEW.z1).toBeGreaterThan(MAP_BOUNDS.z1); expect(MAP_VIEW.x0).toBe(MAP_BOUNDS.x0);
  });
  it('the city harbour and ships are on the ocean, not the river', () => {
    const c = HUB_MAPS.city; expect(c.port.z).toBeGreaterThan(OCEAN.shoreZ - 10);
    for (const [, z] of c.ship) expect(z).toBeGreaterThan(OCEAN.shoreZ - 10);
    expect(c.ship[c.ship.length - 1]![1]).toBeGreaterThan(OCEAN.shoreZ + 250); // sails out to open sea
  });
});

describe('mu-visuals: Fort McChud truck stays on the map', () => {
  it('every fortmc truck waypoint is within the map bounds (+ a small exit margin)', async () => {
    const { FORT_X0, FORT_X1, FORT_Z0, FORT_Z1 } = await import('../shared/fortmc');
    for (const [x, z] of HUB_MAPS.fortmc.truck) { expect(x).toBeGreaterThanOrEqual(FORT_X0 - 8); expect(x).toBeLessThanOrEqual(FORT_X1 + 8); expect(z).toBeGreaterThanOrEqual(FORT_Z0 - 8); expect(z).toBeLessThanOrEqual(FORT_Z1 + 8); }
  });
});
