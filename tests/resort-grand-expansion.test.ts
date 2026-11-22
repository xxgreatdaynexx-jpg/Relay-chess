import { describe, expect, it } from 'vitest';
import {
  resortLots, resortPlots, resortPlotId, RESORT_SPOTS, RESORT_TYPES, RESORT_X0, RESORT_X1, RESORT_Z0, SHORE_Z, RESORT_LAND_BEFORE,
  RESORT_GRAND_FIRST_LOT, RESORT_GRAND_FIRST_PLOT, overlapsResortRoad, resortAabbHit,
} from '../shared/resort';
import { propertyById, isEmployeeHousing } from '../shared/realEstate';
import { HOME_TYPES } from '../shared/homes';
import { homePlan } from '../shared/homePlan';

// Positions of every pre-expansion lot / plot / landmark (ids 1..32 and rf:1..20 must never move).
const OLD_LOTS: Record<string, [number, number]> = Object.fromEntries(resortLots().filter((l) => l.n < RESORT_GRAND_FIRST_LOT).map((l) => [l.id, [l.x, l.z]]));

describe('Chud Resort grand expansion', () => {
  it('doubles the land area (at least) and the width', () => {
    expect(RESORT_X1 - RESORT_X0).toBe(800);
    expect((RESORT_X1 - RESORT_X0) * (SHORE_Z - RESORT_Z0)).toBeGreaterThanOrEqual(RESORT_LAND_BEFORE * 2);
  });
  it('keeps every existing lot, plot and landmark id and position', () => {
    expect(Object.keys(OLD_LOTS)).toHaveLength(32);
    expect(OLD_LOTS['r:beachhouse:1']).toEqual([-78, 29]);
    expect(OLD_LOTS['r:skyrise:32']).toEqual([178, 2]);
    expect(OLD_LOTS['r:villa:22']).toEqual([80, -52]);
    const plots = resortPlots();
    expect(plots.slice(0, 20).map((p) => p.n)).toEqual([...Array(20).keys()].map((i) => i + 1));
    expect(plots.find((p) => p.n === 7)).toMatchObject({ x: -184, z: -112, estate: true });
    expect(plots.find((p) => p.n === 20)).toMatchObject({ x: 98, z: -2 });
    expect(RESORT_SPOTS.find((s) => s.id === 'r-mine')).toMatchObject({ x: 100, z: -80 });
    expect(RESORT_SPOTS.find((s) => s.id === 'r-casino')).toMatchObject({ x: 0, z: -18 });
    expect(RESORT_SPOTS.find((s) => s.id === 'r-farm')).toMatchObject({ x: -74, z: -44 });
  });
  it('appends many new premium lots and plantations, all buyable on the resort map', () => {
    const fresh = resortLots().filter((l) => l.n >= RESORT_GRAND_FIRST_LOT);
    expect(fresh.length).toBeGreaterThanOrEqual(55);
    for (const t of ['beachvilla', 'overwater', 'grandhotel', 'royalestate']) {
      expect(fresh.some((l) => l.type === t), t).toBe(true);
      expect(RESORT_TYPES[t]!.price).toBeGreaterThan(RESORT_TYPES.villa!.price);
    }
    expect(RESORT_TYPES.royalestate!.price).toBeGreaterThan(RESORT_TYPES.skyrise!.price);
    for (const l of fresh) {
      const p = propertyById(l.id)!; expect(p.map).toBe('resort'); expect(isEmployeeHousing(p)).toBe(true);
      if (['beachvilla', 'overwater', 'grandhotel', 'royalestate'].includes(l.type)) { expect(HOME_TYPES.has(l.type)).toBe(true); expect(homePlan(l.type).rooms.length).toBeGreaterThan(4); }
      expect(overlapsResortRoad(l, 1, 0.5), l.id).toBe(false);
    }
    const newPlots = resortPlots().filter((p) => p.n >= RESORT_GRAND_FIRST_PLOT);
    expect(newPlots.length).toBeGreaterThanOrEqual(9);
    for (const p of newPlots) expect(propertyById(resortPlotId(p.n))?.map).toBe('resort');
  });
  it('new amenities sit off the roads and clear of every lot', () => {
    const ids = ['r-beachclub', 'r-cove-pier', 'r-harbour', 'r-helipad'];
    for (const id of ids) {
      const s = RESORT_SPOTS.find((x) => x.id === id)!; expect(s, id).toBeTruthy();
      expect(overlapsResortRoad(s, 1, 0.5), id).toBe(false);
      for (const l of resortLots()) expect(resortAabbHit(s, l, 0.5), `${id} vs ${l.id}`).toBe(false);
    }
  });
});
