import { beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank, START_CHIPS } from '../server/casino-store';
import { Fleet, setFleet } from '../server/fleet';
import { Travel, setTravel, isAtIsland } from '../server/travel';
import { setPriceIndexForTest } from '../server/price-index';
import { CIVIC_IDS, civicRetired, properties, propertyById } from '../shared/realEstate';
import { LANDMARK_IDS, LANDMARK_SLOTS, PLATE, landmarks, cityFill, obbOverlap, clearOfRoads } from '../shared/worldLayout';
import { ISLAND_LOTS } from '../shared/island';
import { CLUB } from '../shared/billionaireClub';
import { SKY_TOWER, SKY_PENTHOUSES } from '../shared/skyPenthouses';
import { zoneOf } from '../shared/zoning';
import { isHomeProperty } from '../shared/homes';
import { fleetModel } from '../shared/fleet';
import { inLake } from '../shared/outskirts';
import { expRoadSegments } from '../shared/expansionRoads';
import { expansionScenery } from '../shared/expansionScenery';
import { inRiver } from '../shared/expansionRiver';
import { inRiverLake } from '../shared/riverLake';
import { JAIL_SITE } from '../shared/jail';
import { BUILDING_IDS, civicPad } from '../shared/city';
import { PLASTICS_PLANT } from '../shared/mapExpansion';
import { WORLD_SPOTS } from '../client/src/lib/worldSpots';
import { readFileSync } from 'node:fs';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });

describe('Billionaire Club, sky penthouses and the private island', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); setFleet(null); });

  it('places the Club and Sky Tower as civic midtown landmarks that never become deeds', () => {
    expect(CIVIC_IDS.has('club')).toBe(true); expect(CIVIC_IDS.has('skytower')).toBe(true);
    expect(LANDMARK_IDS).toEqual(expect.arrayContaining(['club', 'skytower']));
    const lm = landmarks();
    expect(lm.club.x).toBe(-67); expect(lm.club.z).toBe(-10);
    expect(lm.skytower.x).toBe(62); expect(lm.skytower.z).toBe(36);
    expect(CLUB.x).toBe(LANDMARK_SLOTS.club[0]); expect(CLUB.z).toBe(LANDMARK_SLOTS.club[1]);
    expect(SKY_TOWER.x).toBe(LANDMARK_SLOTS.skytower[0]); expect(SKY_TOWER.z).toBe(LANDMARK_SLOTS.skytower[1]);
    expect(Math.abs(lm.club.x) < PLATE && Math.abs(lm.club.z) < PLATE).toBe(true);
    expect(Math.abs(lm.skytower.x) < PLATE && Math.abs(lm.skytower.z) < PLATE).toBe(true);
    expect(propertyById('lm:club')).toBeUndefined();
    expect(propertyById('lm:skytower')).toBeUndefined();
    expect(WORLD_SPOTS.some((s) => s.id === 'club')).toBe(true);
    expect(WORLD_SPOTS.some((s) => s.id === 'skytower')).toBe(true);
  });

  it('appends six sky penthouses and four island estates with stable ids and interiors', () => {
    const ids = properties().map((p) => p.id);
    expect(SKY_PENTHOUSES.every((u) => ids.includes(u.id))).toBe(true);
    expect(ISLAND_LOTS.every((l) => ids.includes(l.id))).toBe(true);
    for (const u of SKY_PENTHOUSES) {
      const p = propertyById(u.id)!; expect(p.type).toBe('penthouse'); expect(p.map).toBeUndefined();
      expect(isHomeProperty(p)).toBe(true); expect(zoneOf(p)).toBe('residential'); expect(p.price).toBe(u.price);
    }
    for (const l of ISLAND_LOTS) {
      const p = propertyById(l.id)!; expect(p.map).toBe('island'); expect(isHomeProperty(p)).toBe(true); expect(zoneOf(p)).toBe('exempt');
    }
    // Units are floors of the civic tower: catalog positions sit on the tower pad; ids and prices stay unique.
    const pads = SKY_PENTHOUSES.map((u) => propertyById(u.id)!);
    const tower = landmarks().skytower;
    for (const p of pads) {
      expect(p.x).toBe(SKY_TOWER.x); expect(p.z).toBe(SKY_TOWER.z);
      expect(Math.abs(p.x - tower.x)).toBeLessThanOrEqual(tower.w / 2);
      expect(Math.abs(p.z - tower.z)).toBeLessThanOrEqual(tower.d / 2);
    }
    expect(new Set(pads.map((p) => p.id)).size).toBe(6);
    expect(new Set(SKY_PENTHOUSES.map((u) => u.floor)).size).toBe(6);
  });

  it('sits on city land, clears roads, water, the jail, the plastics plant, other plots, and park trees', () => {
    const lm = landmarks();
    const fill = cityFill();
    const boxes = [
      { id: 'club', box: lm.club },
      { id: 'skytower', box: lm.skytower },
    ];
    const jail = { x: JAIL_SITE.x, z: JAIL_SITE.z, w: 22 * 1.4 + 4, d: 16 * 1.4 + 4, rot: JAIL_SITE.rot };
    const plastics = { x: PLASTICS_PLANT.x, z: PLASTICS_PLANT.z, w: PLASTICS_PLANT.w, d: PLASTICS_PLANT.d, rot: PLASTICS_PLANT.rot };
    const segClearance = (box: { x: number; z: number; w: number; d: number }, a: [number, number], b: [number, number], rw: number) => {
      const x0 = box.x - box.w / 2, x1 = box.x + box.w / 2, z0 = box.z - box.d / 2, z1 = box.z + box.d / 2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(4, Math.ceil(len / 2));
      let best = Infinity;
      for (let i = 0; i <= n; i++) {
        const t = i / n, sx = a[0] + (b[0] - a[0]) * t, sz = a[1] + (b[1] - a[1]) * t;
        const cx = Math.max(x0, Math.min(sx, x1)), cz = Math.max(z0, Math.min(sz, z1));
        best = Math.min(best, Math.hypot(sx - cx, sz - cz) - rw / 2);
      }
      return best;
    };
    const expRoads: Array<[[number, number], [number, number], number]> = expRoadSegments().map((g) => [g.a, g.b, g.w]);
    for (const { id, box } of boxes) {
      // City streets use the same clearance helper as every other midtown landmark.
      expect(clearOfRoads(box, 1.2), `${id} on a road`).toBe(true);
      for (const [a, b, w] of expRoads) {
        expect(segClearance(box, a, b, w), `${id} expansion road ${a}–${b}`).toBeGreaterThanOrEqual(2);
      }
      const x0 = box.x - box.w / 2, x1 = box.x + box.w / 2, z0 = box.z - box.d / 2, z1 = box.z + box.d / 2;
      for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [box.x, box.z]] as [number, number][]) {
        expect(inRiver(x, z, 2) || inRiverLake(x, z) || inLake(x, z, 2), `${id} water at ${x},${z}`).toBe(false);
      }
      expect(obbOverlap(box, jail, 2), `${id} overlaps the jail`).toBe(false);
      expect(obbOverlap(box, plastics, 2), `${id} overlaps the plastics plant`).toBe(false);
      for (const [oid, b] of Object.entries(lm)) {
        if (oid === id) continue;
        expect(obbOverlap(box, b, 2), `${id} overlaps landmark ${oid}`).toBe(false);
      }
      for (const cid of BUILDING_IDS) {
        expect(obbOverlap(box, civicPad(cid), 2), `${id} overlaps civic ${cid}`).toBe(false);
      }
      const yard = (x: number, z: number, r = 2) => x >= x0 - r && x <= x1 + r && z >= z0 - r && z <= z1 + r;
      const trees = expansionScenery().filter((s) => (s.kind === 'deciduous' || s.kind === 'pine' || s.kind === 'bush') && yard(s.x, s.z, 2));
      expect(trees, trees.map((s) => `${s.kind}@${s.x.toFixed(1)},${s.z.toFixed(1)}`).join(', ')).toHaveLength(0);
    }
    expect(obbOverlap(lm.club, lm.skytower, 2)).toBe(false);
    // Lots under the pads stay in the catalog as retired deeds; every house id stays put.
    expect(fill.houses).toHaveLength(306);
    const under = [
      'b:house:-691:-188', 'b:rowhouse:-590:-182', 'p:park:-667:-111',
      'b:rowhouse:710:331', 'b:house:659:386', 'b:house:646:434', 'b:house:660:334', 'p:lot:592:349',
    ];
    for (const id of under) {
      const p = propertyById(id);
      expect(p, id).toBeTruthy();
      expect(p!.retired, id).toBe(true);
      expect(civicRetired(p!)).toBe(true);
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
