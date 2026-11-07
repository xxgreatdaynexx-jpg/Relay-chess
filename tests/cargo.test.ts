import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank } from '../server/casino-store';
import { getMines, resetMines } from '../server/mines';
import { setPriceIndexForTest } from '../server/price-index';
import { Logistics } from '../server/logistics';
import { Fleet, setFleet } from '../server/fleet';
import { CARGO, MIN_PAYBACK_DAYS, OWN_TRUCK_MIN_FUEL, PUBLIC_PER_UNIT, TRUCK_UNIT, ownFeeBase, payback, perUnitBase, tripsFor } from '../shared/cargo';
import { TRUCKS, MODES, truckTravelMs, feeBase } from '../shared/logistics';
import { BOATS, JETS } from '../shared/fleet';
import { LAUNCH } from '../shared/launchPopup';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `f:${n}:${Math.random()}`, game: 'admin' });
const chips = (n: string) => getBank().account(n).chips;
const tiers = { truck: TRUCKS.map((t) => ({ id: t.id, price: t.price, up: 0 })), boat: BOATS.map((b) => ({ id: b.id, price: b.price, up: 0 })), jet: JETS.map((j) => ({ id: j.id, price: j.price, up: j.upkeep ?? 0 })) };

describe('cargo capacity by tier (mu-cargo)', () => {
  it('capacity rises with size and price in every kind; trucks are 1x / ~3x / ~6x', () => {
    for (const list of Object.values(tiers)) for (let i = 1; i < list.length; i++) { expect(CARGO[list[i]!.id]!.cap).toBeGreaterThan(CARGO[list[i - 1]!.id]!.cap); expect(list[i]!.price).toBeGreaterThan(list[i - 1]!.price); }
    expect(CARGO.pickup!.cap).toBe(TRUCK_UNIT); expect(CARGO.semi!.cap / TRUCK_UNIT).toBe(3); expect(CARGO.tanker!.cap / TRUCK_UNIT).toBe(6);
    for (const t of TRUCKS) expect(t.cap).toBe(CARGO[t.id]!.cap);
  });
  it('a bigger load means fewer trips and a lower per-unit fee', () => {
    const q = 12_000; const trips = TRUCKS.map((t) => tripsFor(q, t.cap)); expect(trips).toEqual([12, 6, 4, 2]);
    for (const list of Object.values(tiers)) for (let i = 1; i < list.length; i++) expect(perUnitBase(list[i]!.id)).toBeLessThan(perUnitBase(list[i - 1]!.id));
    for (const list of Object.values(tiers)) for (const v of list) expect(perUnitBase(v.id)).toBeLessThan(PUBLIC_PER_UNIT[CARGO[v.id]!.kind]);
    expect(ownFeeBase('tanker', q, false)).toBeLessThan(ownFeeBase('pickup', q, false));
    expect(ownFeeBase('pickup', 1, true)).toBe(OWN_TRUCK_MIN_FUEL); expect(ownFeeBase('pickup', 1000, true)).toBe(CARGO.pickup!.trip); expect(ownFeeBase('skiff', 1, true)).toBe(CARGO.skiff!.trip + CARGO.skiff!.useUpkeep);
  });
  it('own trucks: fuel only, never any upkeep, and always <= 50% of a hired rig for every tier and quantity', () => {
    for (const t of TRUCKS) { expect(CARGO[t.id]!.useUpkeep).toBe(0);
      for (const q of [1, 2, 5, 12, 13, 50, 99, 250, 999, 1000, 1001, 2000, 2999, 3001, 6000, 12_345, 100_000]) { const own = ownFeeBase(t.id, q, true); expect(own).toBe(ownFeeBase(t.id, q, false)); expect(own).toBeLessThanOrEqual(0.5 * feeBase('hired', q)); }
      for (let q = 1; q <= 3000; q++) expect(ownFeeBase(t.id, q, true) * 2).toBeLessThanOrEqual(feeBase('hired', q)); }
  });
  it('payback guard: no tier is free money; big tiers never pay back faster than small ones', () => {
    for (const list of Object.values(tiers)) { let last = 0;
      for (const v of list) { const p = payback(v.id, v.price, v.up); expect(p.saving).toBeGreaterThan(0); expect(p.days).toBeGreaterThanOrEqual(MIN_PAYBACK_DAYS); expect(p.days).toBeGreaterThanOrEqual(last); last = p.days; } }
  });
  it('is in the launch popup', () => { expect(LAUNCH.items.some((i) => /Cargo capacity/.test(i.title) && /fewer trips/.test(i.text))).toBe(true); });
});

describe('Logistics with cargo capacity (mu-cargo)', () => {
  const H = 3_600_000; let now = Date.parse('2026-11-04T10:00:00Z'); let l: Logistics;
  beforeEach(() => { resetBank(); resetMines(); setPriceIndexForTest(1); now = Date.parse('2026-11-04T10:00:00Z'); l = new Logistics(null, () => now); l.exists = async (n) => n.toLowerCase() === 'qa-friend'; });
  afterEach(() => { setPriceIndexForTest(1); setFleet(null); });
  it('own truck: multi-trip load, fuel only by the load, on the price index', async () => {
    fund('QA-Cg', 200_000); getMines().adjustStack('QA-Cg', 'ore', 'copper', 20_000); await l.buyTruck('QA-Cg', 'semi'); const c0 = chips('QA-Cg');
    const r = await l.ship('QA-Cg', { mode: 'truck', to: 'city', recipient: 'QA-Friend', type: 'ore', id: 'copper', qty: 7_000 });
    expect(r.trips).toBe(3); expect(r.shipment.fee).toBe(630); expect(chips('QA-Cg')).toBe(c0 - r.shipment.fee);
    expect(r.shipment.arriveAt - r.shipment.departAt).toBe(truckTravelMs(TRUCKS.find((t) => t.id === 'semi')!) * 5);
    now = r.shipment.arriveAt; l.tick();
    const r2 = await l.ship('QA-Cg', { mode: 'truck', to: 'city', recipient: 'QA-Friend', type: 'ore', id: 'copper', qty: 3_000 }); expect(r2.shipment.fee).toBe(270); // fuel only, no day upkeep
    now = r2.shipment.arriveAt + 24 * H; l.tick(); setPriceIndexForTest(2);
    const r3 = await l.ship('QA-Cg', { mode: 'truck', to: 'city', recipient: 'QA-Friend', type: 'ore', id: 'copper', qty: 100 }); expect(r3.shipment.fee).toBe(2 * 9); // price index
  });
  it('the tanker moves the same goods in fewer trips for less than the pickup', async () => {
    fund('QA-Big', 500_000); fund('QA-Small', 500_000); for (const n of ['QA-Big', 'QA-Small']) getMines().adjustStack(n, 'ore', 'copper', 12_000);
    await l.buyTruck('QA-Big', 'tanker'); await l.buyTruck('QA-Small', 'pickup');
    const big = await l.ship('QA-Big', { mode: 'truck', to: 'city', recipient: 'QA-Friend', type: 'ore', id: 'copper', qty: 12_000 }); const small = await l.ship('QA-Small', { mode: 'truck', to: 'city', recipient: 'QA-Friend', type: 'ore', id: 'copper', qty: 12_000 });
    expect(big.trips).toBe(2); expect(small.trips).toBe(12); expect(big.shipment.fee).toBeLessThan(small.shipment.fee);
  });
  it('own jet carries freight: capacity by tier, leaves now, fuel fee only', async () => {
    const f = new Fleet(null, () => now); setFleet(f); fund('QA-JetCg', 500_000); await f.buy('QA-JetCg', 'jet', 'citation'); getMines().adjustStack('QA-JetCg', 'ore', 'copper', 5_000); const c0 = chips('QA-JetCg');
    const r = await l.ship('QA-JetCg', { mode: 'jet', to: 'resort', type: 'ore', id: 'copper', qty: 5_000 });
    expect(r.trips).toBe(2); expect(r.shipment.fee).toBe(2 * 900); expect(r.shipment.departAt).toBe(now); expect(r.shipment.arriveAt - now).toBe(MODES.jet.travelMs * 3); expect(chips('QA-JetCg')).toBe(c0 - 1_800);
    expect(l.live()[0]!.label).toMatch(/QA-JetCg's jet/);
    await expect(l.ship('QA-JetCg', { mode: 'jet', to: 'fortmc', type: 'ore', id: 'copper', qty: 1 })).rejects.toThrow(/out on deliveries|only have/);
    await expect(l.ship('QA-JetCg', { mode: 'boat', to: 'fortmc', type: 'ore', id: 'copper', qty: 1 })).rejects.toThrow(/do not own a boat/);
  });
  it('public carriers keep their single-load cap', async () => {
    fund('QA-Pub', 100_000); getMines().adjustStack('QA-Pub', 'ore', 'copper', 5_000);
    await expect(l.ship('QA-Pub', { mode: 'hired', to: 'city', recipient: 'QA-Friend', type: 'ore', id: 'copper', qty: MODES.hired.cap + 1 })).rejects.toThrow(/max/);
  });
});
