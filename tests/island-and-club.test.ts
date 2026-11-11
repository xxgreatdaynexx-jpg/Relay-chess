import { beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank, START_CHIPS } from '../server/casino-store';
import { Fleet, setFleet } from '../server/fleet';
import { Travel, setTravel, isAtIsland } from '../server/travel';
import { setPriceIndexForTest } from '../server/price-index';
import { CIVIC_IDS, properties, propertyById } from '../shared/realEstate';
import { LANDMARK_IDS, landmarks } from '../shared/worldLayout';
import { ISLAND_LOTS } from '../shared/island';
import { SKY_PENTHOUSES } from '../shared/skyPenthouses';
import { zoneOf } from '../shared/zoning';
import { isHomeProperty } from '../shared/homes';
import { fleetModel } from '../shared/fleet';
import { WORLD_SPOTS } from '../client/src/lib/worldSpots';
import { readFileSync } from 'node:fs';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });

describe('Billionaire Club, sky penthouses and the private island', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); setFleet(null); });

  it('places the Club and Sky Tower as civic ocean-beach landmarks that never become deeds', () => {
    expect(CIVIC_IDS.has('club')).toBe(true); expect(CIVIC_IDS.has('skytower')).toBe(true);
    expect(LANDMARK_IDS).toEqual(expect.arrayContaining(['club', 'skytower']));
    const lm = landmarks();
    expect(lm.club.x).toBe(-80); expect(lm.skytower.x).toBe(-56);
    expect(propertyById('lm:club')).toBeUndefined();
    expect(propertyById('lm:skytower')).toBeUndefined();
    expect(WORLD_SPOTS.some((s) => s.id === 'club')).toBe(true);
  });

  it('appends six sky penthouses and four island estates with stable ids and interiors', () => {
    const ids = properties().map((p) => p.id);
    expect(ids.slice(-10)).toEqual([...SKY_PENTHOUSES.map((u) => u.id), ...ISLAND_LOTS.map((l) => l.id)]);
    for (const u of SKY_PENTHOUSES) {
      const p = propertyById(u.id)!; expect(p.type).toBe('penthouse'); expect(p.map).toBeUndefined();
      expect(isHomeProperty(p)).toBe(true); expect(zoneOf(p)).toBe('residential'); expect(p.price).toBe(u.price);
    }
    for (const l of ISLAND_LOTS) {
      const p = propertyById(l.id)!; expect(p.map).toBe('island'); expect(isHomeProperty(p)).toBe(true); expect(zoneOf(p)).toBe('exempt');
    }
    // unique pads, no overlap between sky units
    const pads = SKY_PENTHOUSES.map((u) => propertyById(u.id)!);
    for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
      const a = pads[i]!, b = pads[j]!;
      expect(Math.abs(a.x - b.x) * 2 >= a.w + b.w || Math.abs(a.z - b.z) * 2 >= a.d + b.d).toBe(true);
    }
  });

  it('lets a megayacht or a jet reach the island, and refuses a ticketed flight', async () => {
    const f = new Fleet(null); setFleet(f); const t = new Travel(null); setTravel(t);
    await expect(t.fly('QA-Walk', 'island')).rejects.toThrow(/megayacht|jet/i);
    expect(isAtIsland('QA-Walk')).toBe(false);

    const jPrice = fleetModel('citation', 'jet')!.price;
    await fund('QA-JetIsl', jPrice);
    await f.buy('QA-JetIsl', 'jet', 'citation');
    const r = await t.fly('QA-JetIsl', 'island');
    expect(r.fee).toBe(0); expect(r.loc).toBe('island'); expect(isAtIsland('QA-JetIsl')).toBe(true);
    await t.home('QA-JetIsl');

    const mPrice = fleetModel('megayacht', 'boat')!.price;
    await fund('QA-Mega', mPrice);
    await f.buy('QA-Mega', 'boat', 'megayacht');
    const s = await t.fly('QA-Mega', 'island');
    expect(s.fee).toBe(0); expect(s.loc).toBe('island'); expect(isAtIsland('QA-Mega')).toBe(true);
    setFleet(null);
  });

  it('moves the Prestige Desk out of City Hall and into the Club', () => {
    const hall = readFileSync(new URL('../client/src/components/CityHallPanel.tsx', import.meta.url), 'utf8');
    const club = readFileSync(new URL('../client/src/components/BillionaireClub.tsx', import.meta.url), 'utf8');
    expect(hall).not.toMatch(/open-prestige-desk/);
    expect(club).toMatch(/open-prestige-desk/);
    expect(club).toMatch(/club-plaques/);
  });
});
