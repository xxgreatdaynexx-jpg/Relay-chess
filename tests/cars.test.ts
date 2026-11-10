import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { PgCasinoStore, START_CHIPS, getBank, resetBank } from '../server/casino-store';
import { Garage, DriveRelay } from '../server/cars';
import { RealEstate } from '../server/realEstate';
import { setPriceIndexForTest } from '../server/price-index';
import { CARS, CAR_BY_ID, carValue, validDrive, unitsPerSec, DRIVE_IDLE_MS, DRIVE_MAX_VISIBLE } from '../shared/cars';

const DAY = 86_400_000;
const fund = (n: string, amt = 20_000) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });
describe('car catalog', () => {
  it('has unique cars with prices, colours and stats', () => {
    expect(CARS.length).toBeGreaterThanOrEqual(22);
    expect(new Set(CARS.map((c) => c.id)).size).toBe(CARS.length);
    expect(CARS.map((c) => c.id)).toEqual(expect.arrayContaining(['chudmobile', 'nightshade', 'apex']));
    expect(CAR_BY_ID.get('apex')!.price).toBeGreaterThan(CAR_BY_ID.get('nightshade')!.price);
    expect(CAR_BY_ID.get('nightshade')!.price).toBeGreaterThan(CAR_BY_ID.get('chudmobile')!.price);
    for (const c of CARS) { expect(c.price).toBeGreaterThan(0); expect(c.colors.length).toBeGreaterThan(c.id === 'taxi' ? 0 : 1); expect(c.topKmh).toBeGreaterThan(0); }
  });
  it('depreciates 60% → -0.5%/day → 40% floor', () => {
    expect(carValue(10_000, 0, 0)).toBe(6000);
    expect(carValue(10_000, 0, 10 * DAY)).toBe(5500);
    expect(carValue(10_000, 0, 365 * DAY)).toBe(4000);
  });
});

describe('validDrive', () => {
  const top = CAR_BY_ID.get('commuter')!.topKmh;
  it('rejects garbage, out of bounds, absurd speed and teleports', () => {
    expect(validDrive({ x: 0, z: 0, a: 0, v: 5 }, null, 0, top)).toBe(true);
    expect(validDrive({ x: NaN, z: 0, a: 0, v: 0 }, null, 0, top)).toBe(false);
    expect(validDrive({ x: 500, z: 0, a: 0, v: 0 }, null, 0, top)).toBe(false);
    expect(validDrive({ x: 0, z: 0, a: 0, v: 999 }, null, 0, top)).toBe(false);
    const prev = { x: 0, z: 0, a: 0, v: 5, t: 0 };
    expect(validDrive({ x: 2, z: 0, a: 0, v: 5 }, prev, 125, top)).toBe(true);
    expect(validDrive({ x: 80, z: 0, a: 0, v: 5 }, prev, 125, top)).toBe(false);
    expect(validDrive({ x: unitsPerSec(top) * 0.125, z: 0, a: 0, v: 5 }, prev, 125, top)).toBe(true);
  });
});

describe('DriveRelay', () => {
  it('relays, rejects teleports, drops idle and disconnected drivers, caps visible', () => {
    let now = 1000; const r = new DriveRelay(() => now); const car = { carId: 'taxi', color: 0xffcc00 };
    expect(r.update('s1', 'QA-A', car, { x: 0, z: 0, a: 0, v: 3 })).toBe(true);
    now += 125; expect(r.update('s1', 'QA-A', car, { x: 100, z: 0, a: 0, v: 3 })).toBe(false);
    expect(r.snapshot()[0].slice(0, 4)).toEqual(['QA-A', 'taxi', 0xffcc00, 0]);
    r.update('s2', 'QA-B', car, { x: 5, z: 5, a: 0, v: 0 }); expect(r.snapshot()).toHaveLength(2);
    r.dropSocket('s2'); expect(r.snapshot()).toHaveLength(1);
    now += DRIVE_IDLE_MS + 1; expect(r.snapshot()).toHaveLength(0);
    for (let i = 0; i < 40; i++) r.update(`x${i}`, `QA-${i}`, car, { x: 0, z: 0, a: 0, v: 0 });
    expect(r.snapshot()).toHaveLength(DRIVE_MAX_VISIBLE);
  });
});

describe('Garage', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  afterEach(() => setPriceIndexForTest(1));
  it('buys, owns several, sets active, sells back at depreciated value (memory)', async () => {
    let now = 0; const g = new Garage(null, () => now);
    await expect(g.buy('QA-Car', 'chudmobile', 0)).rejects.toThrow(/Not enough chips/);
    await fund('QA-Car'); const a = await g.buy('QA-Car', 'cart', CAR_BY_ID.get('cart')!.colors[1]);
    const b = await g.buy('QA-Car', 'rustbucket', 0);
    expect(getBank().account('QA-Car').chips).toBe(START_CHIPS + 20_000 - 800 - 1500);
    expect((await g.active('QA-Car'))?.carId).toBe('cart');
    await g.setActive('QA-Car', b.id); expect((await g.active('QA-Car'))?.carId).toBe('rustbucket');
    now = 10 * DAY; const s = await g.sell('QA-Car', a.id); expect(s.paid).toBe(440);
    expect((await g.garage('QA-Car')).cars).toHaveLength(1);
    await expect(g.sell('QA-Car', a.id)).rejects.toThrow(/do not own/);
  });
  it('charges and resells through the price index', async () => {
    setPriceIndexForTest(1.5); const g = new Garage(null, () => 0);
    await fund('QA-Inf'); const r = await g.buy('QA-Inf', 'cart', 0); expect(r.price).toBe(1200);
    setPriceIndexForTest(2); expect((await g.sell('QA-Inf', r.id)).paid).toBe(960);
  });
  it('writes car_owned and a car_buy ledger row in one transaction (Postgres)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool));
    await new RealEstate(pool, () => getBank()).init();
    const g = new Garage(pool, () => 0); await g.init();
    await fund('QA-Pg'); const r = await g.buy('QA-Pg', 'commuter', 0);
    expect(db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'car_buy'`).map((x) => Number(x.amount))).toEqual([-7000]);
    expect(db.public.many('SELECT car_id FROM car_owned')).toEqual([{ car_id: 'commuter' }]);
    expect(getBank().account('QA-Pg').chips).toBe(START_CHIPS + 20_000 - 7000);
    await g.sell('QA-Pg', r.id);
    expect(db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'car_sell'`).map((x) => Number(x.amount))).toEqual([4200]);
    expect(db.public.many('SELECT * FROM car_owned')).toHaveLength(0);
    expect(await new Garage(pool).values()).toEqual([]);
  });
});
