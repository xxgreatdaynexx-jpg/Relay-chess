import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { PgCasinoStore, START_CHIPS, getBank, resetBank } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Garage, DriveRelay } from '../server/cars';
import { setPriceIndexForTest } from '../server/price-index';
import { CARS, CAR_BY_ID, unitsPerSec, DRIVE_SPEED_CAP, FASTEST_BASE_KMH } from '../shared/cars';
import { STOCK_MODS, normMods, perfPriceBase, cosmeticPriceBase, moddedStats, maxKmh, lookCode, parseLook, PAINTS, MAX_SPEED_FACTOR, ENGINE_SWAPS, CAR_SWAPS, allowedSwaps, swappedBase, maxSwapTopKmh, legacyModsJson, type CarMods } from '../shared/mechanic';
import { carMinLapMs } from '../server/race';
import { minLapMs } from '../shared/racePhysics';

const fund = (n: string, amt = 50_000) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });
const MAXED: CarMods = { ...STOCK_MODS, engine: 3, turbo: 3, tires: 3, handling: 3, nitro: 3 };

describe('mechanic catalog', () => {
  it('prices scale with car value, with floors, and rise by tier', () => {
    const cheap = CAR_BY_ID.get('cart')!, pricey = CAR_BY_ID.get('phantom')!;
    expect(perfPriceBase(cheap, 1)).toBe(200); expect(perfPriceBase(cheap, 4)).toBeNull();
    for (const c of CARS) { const p = [1, 2, 3].map((t) => perfPriceBase(c, t)!); expect(p[0]).toBeLessThan(p[1]!); expect(p[1]).toBeLessThan(p[2]!); }
    expect(perfPriceBase(pricey, 3)).toBe(Math.round(pricey.price * 0.18));
    expect(cosmeticPriceBase(cheap)).toBe(150); expect(cosmeticPriceBase(pricey)).toBeGreaterThan(150);
    expect(PAINTS.filter((p) => p.metallic).length).toBeGreaterThanOrEqual(5);
  });
  it('normMods cleans junk and the look code round-trips', () => {
    expect(normMods(null)).toEqual(STOCK_MODS);
    expect(normMods({ engine: 9, turbo: -1, rims: 'bogus', paint: 'nope', glow: 'cyan' })).toEqual({ ...STOCK_MODS, glow: 'cyan' });
    expect(lookCode(STOCK_MODS)).toBe('');
    const m = { ...STOCK_MODS, paint: PAINTS[0]!.id, rims: 'gold', kit: 'wing', glow: 'pink' };
    expect(parseLook(lookCode(m))).toEqual({ paint: m.paint, rims: 'gold', kit: 'wing', glow: 'pink' });
    expect(parseLook('x|y|z|w')).toEqual({ paint: null, rims: 'stock', kit: 'none', glow: 'none' });
  });
  it('caps: a maxed cheap car never catches a stock top car, and every maxed car stays under the server cap', () => {
    const top = Math.max(...CARS.map((c) => c.topKmh));
    for (const c of CARS) { if (c.topKmh < top * 0.6) expect(maxKmh(c, MAXED)).toBeLessThan(top); expect(unitsPerSec(maxKmh(c, MAXED))).toBeLessThanOrEqual(DRIVE_SPEED_CAP); }
    expect(MAX_SPEED_FACTOR).toBeLessThan(1.35);
    const s = moddedStats(CAR_BY_ID.get('commuter')!, MAXED), b = CAR_BY_ID.get('commuter')!;
    expect(s.topKmh).toBeGreaterThan(b.topKmh); expect(s.zeroTo100).toBeLessThan(b.zeroTo100); expect(s.nitro).toBe(4);
  });
});

const FULL = (swap: CarMods['swap']): CarMods => ({ ...MAXED, trans: 3, weight: 3, swap });
describe('engine swaps', () => {
  it('pool has 8+ real engines plus joke ones; every car allows 3-5 known swaps', () => {
    expect(ENGINE_SWAPS.length).toBeGreaterThanOrEqual(10);
    for (const id of ['i4t', 'rotary', 'flat6', 'hemi', 'scv8', 'ttv6', 'v12', 'ev2', 'ev4', 'mower', 'jet']) expect(ENGINE_SWAPS.some((s) => s.id === id)).toBe(true);
    for (const c of CARS) { const l = CAR_SWAPS[c.id]!; expect(l.length).toBeGreaterThanOrEqual(3); expect(l.length).toBeLessThanOrEqual(5); expect(allowedSwaps(c)).toHaveLength(l.length); }
  });
  it('balance: any car can become worth having, supers still lead, all under the server cap', () => {
    const best = (id: string) => { const c = CAR_BY_ID.get(id)!; return Math.max(...allowedSwaps(c).map((s) => maxKmh(c, FULL(s.id)))); };
    const r = best('rustbucket'); expect(r).toBeGreaterThanOrEqual(290); expect(r).toBeLessThanOrEqual(345);
    for (const id of ['commuter', 'taxi', 'exec', 'trailblazer', 'hauler']) { expect(best(id)).toBeGreaterThanOrEqual(295); expect(best(id)).toBeLessThanOrEqual(365); }
    const topStock = Math.max(...CARS.map((c) => c.topKmh)); expect(topStock / r).toBeLessThan(1.4);
    for (const c of CARS) for (const s of allowedSwaps(c)) { expect(unitsPerSec(maxKmh(c, FULL(s.id)))).toBeLessThanOrEqual(DRIVE_SPEED_CAP); expect(maxKmh(c, FULL(s.id))).toBeLessThanOrEqual(maxSwapTopKmh(c) * MAX_SPEED_FACTOR + 1e-6); }
    // a swap never lowers a real engine's top speed; the mower is the joke exception
    const rb = CAR_BY_ID.get('rustbucket')!; expect(swappedBase(rb, 'mower').topKmh).toBeLessThan(rb.topKmh); expect(swappedBase(rb, 'hemi').handling).toBeLessThan(rb.handling);
    expect(swappedBase(rb, 'v12')).toEqual({ topKmh: rb.topKmh, zeroTo100: rb.zeroTo100, handling: rb.handling }); // not allowed → stock
  });
  it('super-tier swaps raise top speed, and the cap covers the fastest base', () => {
    for (const c of CARS.filter((x) => x.tier === 'super')) { expect(Math.max(...allowedSwaps(c).map((s) => swappedBase(c, s.id).topKmh))).toBeGreaterThanOrEqual(c.topKmh * 1.08); expect(maxSwapTopKmh(c)).toBeLessThanOrEqual(FASTEST_BASE_KMH); }
    expect(Math.max(...CARS.map(maxSwapTopKmh))).toBe(FASTEST_BASE_KMH);
  });
  it('lap-time floor covers the fastest allowed swap', () => {
    const c = CAR_BY_ID.get('rustbucket')!; expect(carMinLapMs('rustbucket')).toBe(minLapMs(maxSwapTopKmh(c) * MAX_SPEED_FACTOR));
  });
  it('old saves load and normalize; legacy JSON matches the pre-swap shape', () => {
    const old = { engine: 2, turbo: 1, tires: 0, handling: 0, nitro: 0, paint: null, rims: 'stock', kit: 'none', glow: 'none' };
    const m = normMods(old); expect(m).toEqual({ ...STOCK_MODS, engine: 2, turbo: 1 }); expect(legacyModsJson(m)).toBe(JSON.stringify(old));
    expect(normMods({ swap: 'v12' }, CAR_BY_ID.get('rustbucket')!).swap).toBeNull(); expect(normMods({ swap: 'warp' }).swap).toBeNull();
    expect(normMods({ swap: 'hemi', trans: 2, weight: 9 }, CAR_BY_ID.get('rustbucket')!)).toMatchObject({ swap: 'hemi', trans: 2, weight: 0 });
  });
});

describe('mechanic garage', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  afterEach(() => setPriceIndexForTest(1));
  it('buys tiers in order, charges px price, no refunds, resale unchanged (memory)', async () => {
    const g = new Garage(null, () => 0); await fund('QA-Mech');
    const car = await g.buy('QA-Mech', 'commuter', 0); const chips0 = getBank().account('QA-Mech').chips;
    const v0 = (await g.garage('QA-Mech')).cars[0]!.value;
    setPriceIndexForTest(1.5);
    const r = await g.modify('QA-Mech', car.id, { kind: 'perf', part: 'engine', tier: 1 });
    expect(r.price).toBe(Math.round(perfPriceBase(CAR_BY_ID.get('commuter')!, 1)! * 1.5));
    await expect(g.modify('QA-Mech', car.id, { kind: 'perf', part: 'engine', tier: 1 })).rejects.toThrow(/already fitted/);
    await g.modify('QA-Mech', car.id, { kind: 'perf', part: 'engine' }); await g.modify('QA-Mech', car.id, { kind: 'perf', part: 'engine' });
    await expect(g.modify('QA-Mech', car.id, { kind: 'perf', part: 'engine' })).rejects.toThrow(/maxed/);
    const l = await g.modify('QA-Mech', car.id, { kind: 'look', slot: 'rims', value: 'gold' }); expect(l.price).toBeGreaterThan(0);
    const back = await g.modify('QA-Mech', car.id, { kind: 'look', slot: 'rims', value: 'stock' }); expect(back.price).toBe(0);
    await expect(g.modify('QA-Mech', car.id, { kind: 'look', slot: 'glow', value: 'rainbow' })).rejects.toThrow(/Unknown/);
    expect(getBank().account('QA-Mech').chips).toBeLessThan(chips0);
    setPriceIndexForTest(1); const o = (await g.garage('QA-Mech')).cars[0]!; expect(o.value).toBe(v0); expect(o.mods.engine).toBe(3);
    expect((await g.active('QA-Mech'))?.mods.engine).toBe(3);
  });
  it('rejects without chips and for cars you do not own', async () => {
    const g = new Garage(null, () => 0); await fund('QA-Poor', 7000 - START_CHIPS); const c = await g.buy('QA-Poor', 'commuter', 0);
    await expect(g.modify('QA-Poor', c.id, { kind: 'perf', part: 'turbo' })).rejects.toThrow(/Not enough chips/);
    await expect(g.modify('QA-Other', c.id, { kind: 'perf', part: 'turbo' })).rejects.toThrow(/do not own/);
  });
  it('writes mods and a car_mod ledger row atomically; a double buy only charges once (Postgres)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool));
    await new RealEstate(pool, () => getBank()).init();
    const g = new Garage(pool, () => 0); await g.init(); await fund('QA-PgMech');
    const c = await g.buy('QA-PgMech', 'commuter', 0);
    const both = await Promise.allSettled([g.modify('QA-PgMech', c.id, { kind: 'perf', part: 'nitro', tier: 1 }), g.modify('QA-PgMech', c.id, { kind: 'perf', part: 'nitro', tier: 1 })]);
    expect(both.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rows = db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'car_mod'`).map((x) => Number(x.amount));
    expect(rows).toEqual([-perfPriceBase(CAR_BY_ID.get('commuter')!, 1)!]);
    expect(getBank().account('QA-PgMech').chips).toBe(START_CHIPS + 50_000 - 7000 + rows[0]!);
    expect((await new Garage(pool).garage('QA-PgMech')).cars[0]!.mods.nitro).toBe(1);
  });
});

describe('engine swap purchases', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  it('fixed price swap, rejects disallowed, stock back free (memory)', async () => {
    const g = new Garage(null, () => 0); await fund('QA-Swap'); const car = await g.buy('QA-Swap', 'rustbucket', CAR_BY_ID.get('rustbucket')!.colors[0]);
    await expect(g.modify('QA-Swap', car.id, { kind: 'swap', swap: 'v12' })).rejects.toThrow(/does not fit/);
    const r = await g.modify('QA-Swap', car.id, { kind: 'swap', swap: 'hemi' }); expect(r.price).toBe(ENGINE_SWAPS.find((s) => s.id === 'hemi')!.price);
    await expect(g.modify('QA-Swap', car.id, { kind: 'swap', swap: 'hemi' })).rejects.toThrow(/already has/);
    expect((await g.active('QA-Swap'))?.mods.swap).toBe('hemi');
    expect((await g.modify('QA-Swap', car.id, { kind: 'swap', swap: null })).price).toBe(0);
    expect(g.quote((await g.owned('QA-Swap'))[0]!)!.swaps).toHaveProperty('hemi');
  });
  it('a legacy row (old mods JSON, no swap keys) can still be upgraded without "car changed" (Postgres)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool)); await new RealEstate(pool, () => getBank()).init();
    const g = new Garage(pool, () => 0); await g.init(); await fund('QA-Legacy'); const c = await g.buy('QA-Legacy', 'rustbucket', CAR_BY_ID.get('rustbucket')!.colors[0]);
    const old = { engine: 1, turbo: 0, tires: 0, handling: 0, nitro: 0, paint: null, rims: 'stock', kit: 'none', glow: 'none' };
    await pool.query('UPDATE car_owned SET mods = $2::jsonb WHERE id = $1', [c.id, JSON.stringify(old)]);
    await g.modify('QA-Legacy', c.id, { kind: 'swap', swap: 'rotary' });
    await g.modify('QA-Legacy', c.id, { kind: 'perf', part: 'engine', tier: 2 });
    const m = (await new Garage(pool).owned('QA-Legacy'))[0]!.mods; expect(m.swap).toBe('rotary'); expect(m.engine).toBe(2);
  });
});

describe('modded driving', () => {
  it('relay accepts a swapped car at its swapped speed but rejects that speed stock', () => {
    const r = new DriveRelay(() => 1000); const c = CAR_BY_ID.get('rustbucket')!; const v = unitsPerSec(260);
    expect(r.update('s', 'QA-Sw', { carId: c.id, color: 1, mods: FULL('hemi') }, { x: 0, z: 0, a: 0, v })).toBe(true);
    expect(new DriveRelay(() => 1000).update('s', 'QA-Sw2', { carId: c.id, color: 1, mods: MAXED }, { x: 0, z: 0, a: 0, v })).toBe(false);
  });
  it('relay allows a modded car its higher top speed and shares the look', () => {
    let now = 1000; const r = new DriveRelay(() => now); const c = CAR_BY_ID.get('commuter')!;
    const mods = { ...MAXED, glow: 'cyan' }; const fast = unitsPerSec(c.topKmh * 1.6);
    expect(r.update('s', 'QA-Fast', { carId: c.id, color: 1, mods }, { x: 0, z: 0, a: 0, v: fast })).toBe(true);
    expect(r.snapshot()[0]![7]).toBe(lookCode(mods));
    expect(new DriveRelay(() => now).update('s', 'QA-Stock', { carId: c.id, color: 1 }, { x: 0, z: 0, a: 0, v: unitsPerSec(c.topKmh * 1.6) })).toBe(false);
    now += 1;
  });
});

describe('Mechanic Shop venue', async () => {
  const { landmarks, cityFill, obbOverlap, roadClearance } = await import('../shared/worldLayout');
  const { LANDMARK_PRICE, LANDMARK_LABEL } = await import('../shared/realEstate');
  it('sits next to the dealership, clear of roads, landmarks and houses, and is a property', () => {
    const all = landmarks(); const m = all.mechanic!; expect(m).toBeTruthy();
    expect(Math.hypot(m.x - all.dealer!.x, m.z - all.dealer!.z)).toBeLessThan(40);
    expect(roadClearance(m.x, m.z)).toBeGreaterThan(6);
    for (const [id, b] of Object.entries(all)) if (id !== 'mechanic') expect(obbOverlap(b, m, 2)).toBe(false);
    const { houses, patches } = cityFill(7); for (const h of [...houses, ...patches]) expect(obbOverlap(h, m, 1)).toBe(false);
    expect((LANDMARK_PRICE as Record<string, number>).mechanic).toBeGreaterThan(0); expect((LANDMARK_LABEL as Record<string, string>).mechanic).toBe('Mechanic Shop');
  });
});
