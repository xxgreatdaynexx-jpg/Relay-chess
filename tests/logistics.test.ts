import { withFactories, QA_SHIPPERS } from './helpers/factories';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank } from '../server/casino-store';
import { getMines, resetMines } from '../server/mines';
import { setPriceIndexForTest } from '../server/price-index';
import { Logistics } from '../server/logistics';
import { MODES, TRUCKS, feeBase, nextDeparture, vehiclePose, arrivalOf, HUB_MAPS } from '../shared/logistics';
import { LAUNCH } from '../shared/launchPopup';

const HOUR = 3_600_000;
const fund = (n: string, amt = 100_000) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });
const chips = (n: string) => getBank().account(n).chips;
const txs = (n: string) => getBank().account(n) && (getBank() as unknown as { history?: (n: string) => unknown[] });

describe('logistics rules', () => {
  it('ships every 2h are the cheapest; planes hourly; trucks leave now', () => {
    for (const q of [10, 500, 5000]) { expect(feeBase('ship', q)).toBeLessThan(feeBase('plane', q)); expect(feeBase('ship', q)).toBeLessThan(feeBase('hired', q)); }
    expect(feeBase('truck', 9999)).toBe(0);
    const t = 5 * HOUR + 17 * 60_000;
    expect(nextDeparture('plane', t)).toBe(6 * HOUR); expect(nextDeparture('ship', t)).toBe(6 * HOUR); expect(nextDeparture('ship', 6 * HOUR + 1)).toBe(8 * HOUR);
    expect(nextDeparture('truck', t)).toBe(t); expect(nextDeparture('hired', t)).toBe(t);
    expect(MODES.ship.cap).toBeGreaterThan(MODES.plane.cap);
  });
  it('vehicles follow their route: loading at start, moving between, arrived at end; inbound reverses', () => {
    const v = { mode: 'ship' as const, from: 'city' as const, to: 'resort' as const, departAt: 1000, arriveAt: arrivalOf('ship', 1000) };
    expect(vehiclePose(v, 0).phase).toBe('loading'); expect(vehiclePose(v, 2000).phase).toBe('moving'); expect(vehiclePose(v, v.arriveAt).phase).toBe('arrived');
    const a = vehiclePose(v, 1000), b = vehiclePose({ ...v, from: 'resort', to: 'city' }, v.arriveAt);
    expect(a.x).toBeCloseTo(b.x); expect(a.z).toBeCloseTo(b.z);
    const p = vehiclePose({ ...v, mode: 'plane', arriveAt: arrivalOf('plane', 1000) }, 1000 + MODES.plane.travelMs / 2); expect(p.y).toBeGreaterThan(10);
  });
  it('is in the Millionaire launch popup', () => { expect(LAUNCH.items.some((i) => i.title === 'Logistics')).toBe(true); expect(LAUNCH.items.some((i) => /Truck store/.test(i.title))).toBe(true); });
});

describe('Logistics', () => {
  let now = 10 * HOUR + 60_000; let l: Logistics;
  beforeEach(() => { resetBank(); withFactories(resetMines(), ...QA_SHIPPERS); setPriceIndexForTest(1); now = 10 * HOUR + 60_000; l = new Logistics(null, () => now); l.exists = async (n) => n.toLowerCase() === 'qa-friend'; });
  afterEach(() => setPriceIndexForTest(1));

  it('hired truck: fee via ledger, goods escrowed, visible while moving with owner label, delivered on arrival', async () => {
    fund('QA-Ship'); getMines().adjustStack('QA-Ship', 'bar', 'iron_bar', 100); const c0 = chips('QA-Ship');
    const r = await l.ship('QA-Ship', { mode: 'hired', to: 'city', type: 'bar', id: 'iron_bar', qty: 40, recipient: 'QA-Friend' });
    expect(r.shipment.fee).toBe(feeBase('hired', 40)); expect(chips('QA-Ship')).toBe(c0 - r.shipment.fee);
    expect(getMines().stackQty('QA-Ship', 'bar', 'iron_bar')).toBe(60);
    const live = l.live(); expect(live).toHaveLength(1); expect(live[0]!.label).toMatch(/Hired rig · QA-Ship/);
    expect(l.tick()).toHaveLength(0);
    now = r.shipment.arriveAt; expect(l.tick()).toHaveLength(1); expect(l.live()).toHaveLength(0);
    expect(getMines().stackQty('QA-Ship', 'bar', 'iron_bar')).toBe(60); expect(getMines().stackQty('QA-Friend', 'bar', 'iron_bar')).toBe(40);
    expect(chips('QA-Ship')).toBe(c0 - r.shipment.fee); // fee is a sink, nothing refunded or minted
  });
  it('truck store: buy via ledger, owned truck ships for fuel only (mu-cargo), big loads take several trips, shows with owner name, busy truck cannot be sold', async () => {
    fund('QA-Hauler'); const c0 = chips('QA-Hauler'); getMines().adjustStack('QA-Hauler', 'ore', 'copper', 300);
    const b = await l.buyTruck('QA-Hauler', 'pickup'); expect(chips('QA-Hauler')).toBe(c0 - TRUCKS[0]!.price);
    const r = await l.ship('QA-Hauler', { mode: 'truck', to: 'city', type: 'ore', id: 'copper', qty: 200, recipient: 'QA-Friend' });
    expect(r.trips).toBe(1); expect(r.shipment.fee).toBe(24); expect(chips('QA-Hauler')).toBe(c0 - TRUCKS[0]!.price - 24);
    expect(l.live()[0]!.label).toBe("QA-Hauler's Chud Pickup");
    await expect(l.ship('QA-Hauler', { mode: 'truck', to: 'city', type: 'ore', id: 'copper', qty: 10, recipient: 'QA-Friend' })).rejects.toThrow(/out on deliveries/);
    await expect(l.sellTruck('QA-Hauler', b.truck.id)).rejects.toThrow(/out on a delivery/);
    now = r.shipment.arriveAt; l.tick(); expect(l.live()).toHaveLength(0); // trucks only show while goods move
    const s = await l.sellTruck('QA-Hauler', b.truck.id); expect(s.paid).toBe(TRUCKS[0]!.price / 2);
  });
  it('no truck: truck mode refuses and points at hiring; no chips no ship', async () => {
    getMines().adjustStack('QA-Poor', 'bar', 'iron_bar', 10);
    await expect(l.ship('QA-Poor', { mode: 'truck', to: 'city', type: 'bar', id: 'iron_bar', qty: 5, recipient: 'QA-Friend' })).rejects.toThrow(/do not own a truck/);
    getBank().transferConfirmed('QA-Poor', -chips('QA-Poor'), { key: 'drain', game: 'admin' });
    await expect(l.ship('QA-Poor', { mode: 'hired', to: 'city', type: 'bar', id: 'iron_bar', qty: 5, recipient: 'QA-Friend' })).rejects.toThrow(/Not enough chips/);
    expect(getMines().stackQty('QA-Poor', 'bar', 'iron_bar')).toBe(10);
  });
  it('trucks never leave their map (Dayne 2026-11-06): own + hired refused cross-map, client origin ignored, nothing moved; plane/ship unchanged', async () => {
    fund('QA-Map'); getMines().adjustStack('QA-Map', 'bar', 'iron_bar', 100); await l.buyTruck('QA-Map', 'pickup'); const c0 = chips('QA-Map');
    for (const mode of ['truck', 'hired'] as const) for (const to of ['resort', 'fortmc'] as const) for (const from of [undefined, 'resort', 'fortmc', 'city'])
      await expect(l.ship('QA-Map', { mode, from, to, type: 'bar', id: 'iron_bar', qty: 5, recipient: 'QA-Friend' })).rejects.toThrow(/can’t haul to other maps/);
    expect(chips('QA-Map')).toBe(c0); expect(getMines().stackQty('QA-Map', 'bar', 'iron_bar')).toBe(100); expect(l.live()).toHaveLength(0);
    for (const mode of ['plane', 'ship'] as const) {
      // factory→factory freight is Chud City only (the factory is there); cross-map stock moves via 🏭 My places
      await expect(l.ship('QA-Map', { mode, to: 'resort', type: 'bar', id: 'iron_bar', qty: 5 })).rejects.toThrow(/My places/);
      const r = await l.ship('QA-Map', { mode, to: 'city', type: 'bar', id: 'iron_bar', qty: 5, recipient: 'QA-Friend' }); expect(r.shipment).toMatchObject({ mode, from: 'city', to: 'city' }); // same-map plane/ship allowed (original rule never denied it)
    }
    const t = await l.ship('QA-Map', { mode: 'truck', from: 'resort', to: 'city', type: 'bar', id: 'iron_bar', qty: 5, recipient: 'QA-Friend' });
    expect(t.shipment).toMatchObject({ from: 'city', to: 'city' }); // spoofed origin ignored
    expect(() => l.planSell('QA-Map', { mode: 'hired', from: 'resort', type: 'ore', id: 'gold', qty: 5, src: 'coral' })).toThrow(/can’t haul to other maps/);
    expect(() => l.planSell('QA-Map', { mode: 'truck', from: 'fortmc', type: 'ore', id: 'gold', qty: 5, src: 'fortmc' })).toThrow(/can’t haul to other maps/);
    expect(l.planSell('QA-Map', { mode: 'ship', from: 'fortmc', type: 'ore', id: 'gold', qty: 5, src: 'fortmc' }).mode).toBe('ship');
  });
  it('in-flight cross-map truck loads from before the rule still deliver (grandfathered)', async () => {
    fund('QA-Old'); getMines().adjustStack('QA-Old', 'bar', 'iron_bar', 10);
    const old = { id: 'legacy-1', owner: 'qa-old', ownerName: 'QA-Old', toKey: 'qa-old', toName: 'QA-Old', mode: 'hired', truck: null, from: 'city', to: 'resort', type: 'bar', itemId: 'iron_bar', qty: 7, fee: 25, createdAt: now - 1000, departAt: now - 1000, arriveAt: now + 1000, status: 'transit' } as never;
    l.admit(old); expect(l.live()).toHaveLength(1); now += 1000; expect(l.tick()).toHaveLength(1);
    expect(getMines().stackQty('QA-Old', 'bar', 'iron_bar')).toBe(17);
  });
  it('ships/planes wait for their departure, group into one vehicle, and deliver to another player', async () => {
    fund('QA-A'); fund('QA-B'); getMines().adjustStack('QA-A', 'bar', 'iron_bar', 50); getMines().adjustStack('QA-B', 'bar', 'iron_bar', 50);
    const a = await l.ship('QA-A', { mode: 'ship', to: 'city', type: 'bar', id: 'iron_bar', qty: 50, recipient: 'QA-Friend' });
    await l.ship('QA-B', { mode: 'ship', to: 'city', type: 'bar', id: 'iron_bar', qty: 20, recipient: 'QA-Friend' });
    expect(a.shipment.departAt).toBe(12 * HOUR);
    await expect(l.ship('QA-B', { mode: 'ship', to: 'city', type: 'bar', id: 'iron_bar', qty: 1, recipient: 'Nobody' })).rejects.toThrow(/No player/);
    const v = l.live(); expect(v).toHaveLength(1); expect(v[0]).toMatchObject({ mode: 'ship', loads: 2, units: 70, label: 'Cargo ship · 2 shippers' });
    now = a.shipment.arriveAt; l.tick();
    expect(getMines().stackQty('QA-Friend', 'bar', 'iron_bar')).toBe(70); expect(getMines().stackQty('QA-A', 'bar', 'iron_bar')).toBe(0);
  });
  it('rejects junk input', async () => {
    await expect(l.ship('QA-X', { mode: 'teleport', to: 'resort' })).rejects.toThrow(/how to ship/);
    await expect(l.ship('QA-X', { mode: 'ship', to: 'mars' })).rejects.toThrow(/destination/);
    await expect(l.ship('QA-X', { mode: 'ship', to: 'resort', type: 'skin', id: 'x', qty: 1 })).rejects.toThrow(/can not be shipped/);
    await expect(l.ship('QA-X', { mode: 'ship', to: 'resort', type: 'bar', id: 'iron_bar', qty: 1.5 })).rejects.toThrow(/quantity/);
    await expect(l.buyTruck('QA-X', 'spaceship')).rejects.toThrow(/not in the store/);
    void txs;
  });
});

describe('logistics on every map', () => {
  it('every map has an ocean port and a ship route that starts at it', async () => {
    const { HUB_IDS, HUB_MAPS, routeOf, onMap } = await import('../shared/logistics');
    for (const h of HUB_IDS) { const p = HUB_MAPS[h].port; expect(routeOf('ship', h)[0]).toEqual([p.x, p.z]); }
    expect(onMap({ from: 'city', to: 'resort' }, 'resort')).toBe(true); expect(onMap({ from: 'city', to: 'resort' }, 'fortmc')).toBe(false);
  });
  it('a load leaving the city shows arriving at the resort port on the resort map', () => {
    const v = { mode: 'ship' as const, from: 'city' as const, to: 'resort' as const, departAt: 0, arriveAt: arrivalOf('ship', 0) };
    const end = vehiclePose(v, v.arriveAt - 1, 'resort'); expect(Math.hypot(end.x - HUB_MAPS.resort.port.x, end.z - HUB_MAPS.resort.port.z)).toBeLessThan(2);
  });
});
