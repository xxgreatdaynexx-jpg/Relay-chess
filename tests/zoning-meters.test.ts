/** Zoning meters: the player-facing counts are the same ones the purchase check enforces. */
import { describe, expect, it } from 'vitest';
import { properties, type Property } from '../shared/realEstate';
import { zoningSummary, zoneUse, zoneRefusal, ZONE_DEED_CAP, FARMLAND_TILE_CAP, tilesOf } from '../shared/zoning';

const all = [...properties()].filter((p) => !p.retired);
const houses = all.filter((p) => p.type === 'house' && !p.map); const shops = all.filter((p) => ['gas', 'depot', 'barn'].includes(p.type));
const farms = all.filter((p) => p.kind === 'farm' && !p.map); const patch = all.find((p) => p.kind === 'patch')!;
const resort = all.find((p) => p.map === 'resort' && p.kind === 'building')!;

describe('zoningSummary', () => {
  it('counts residential, commercial deeds and farmland tiles exactly like zoneUse', () => {
    const owned: Property[] = [...houses.slice(0, 3), ...shops.slice(0, 2), farms[0]!, farms[1]!, patch, resort];
    const z = zoningSummary(owned); const u = zoneUse(owned);
    expect(z.residential).toEqual({ owned: 3, cap: ZONE_DEED_CAP });
    expect(z.commercial).toEqual({ owned: 2, cap: ZONE_DEED_CAP });
    expect(z.farmland).toEqual({ tiles: u.farmlandTiles, cap: FARMLAND_TILE_CAP, plots: 2 });
    expect(z.farmland.tiles).toBe(tilesOf(farms[0]!) + tilesOf(farms[1]!));
    expect(z.exempt).toBe(2);
    expect(z.notes.some((n) => /2 of your properties are exempt/.test(n))).toBe(true);
    expect(z.notes.some((n) => /over the|at the/.test(n))).toBe(false);
  });
  it('notes grandfathered over-cap holdings, and the meter agrees with the refusal', () => {
    const owned = houses.slice(0, ZONE_DEED_CAP + 2);
    const z = zoningSummary(owned);
    expect(z.residential.owned).toBe(ZONE_DEED_CAP + 2);
    expect(z.notes.find((n) => n.startsWith('Residential'))).toMatch(/over the 10 cap.*keep them all/);
    expect(zoneRefusal(zoneUse(owned), houses[ZONE_DEED_CAP + 2]!)).toMatch(/Zoning cap/);
  });
  it('at exactly the cap says so', () => {
    expect(zoningSummary(shops.slice(0, ZONE_DEED_CAP)).notes.join(' ')).toMatch(/Commercial: at the 10-deed cap/);
  });
  it('unreadable farmland size fails closed and serialises as null, not Infinity', () => {
    const bad = { ...farms[0]!, tiles: undefined } as Property;
    const z = zoningSummary([bad]);
    expect(z.farmland.tiles).toBeNull();
    expect(JSON.parse(JSON.stringify(z)).farmland.tiles).toBeNull();
    expect(z.notes.join(' ')).toMatch(/paused for safety/);
  });
  it('empty portfolio', () => {
    expect(zoningSummary([])).toEqual({ residential: { owned: 0, cap: 10 }, commercial: { owned: 0, cap: 10 }, farmland: { tiles: 0, cap: 2000, plots: 0 }, exempt: 0, notes: [] });
  });
});
