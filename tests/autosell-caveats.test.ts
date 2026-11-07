// Millionaire Update auto-sell caveats: Fort McChud -> factory by truck, warehouse-only rule for fish/dishes, indexed fee preview.
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank, CasinoBank, PgCasinoStore } from '../server/casino-store';
import { newDb } from 'pg-mem';
import { LOGISTICS_MIGRATION } from '../server/logistics';
import { resetMines } from '../server/mines';
import { setPriceIndexForTest } from '../server/price-index';
import { Logistics, setLogistics, type Shipment } from '../server/logistics';
import { FortMc, setFortMc } from '../server/fortmc';
import { Warehouse, setWarehouse } from '../server/warehouse';
import { Travel, setTravel, awayFromMarket, MARKET_AWAY_MSG } from '../server/travel';
import { playerKey } from '../server/skins';
import { feeBase, shipFee, MODES } from '../shared/logistics';
import { indexed } from '../shared/priceIndex';
import { newFort } from '../shared/fortmc';
import type { OreId } from '../shared/mines';

const H = 3_600_000; const N = 'QA-Cole-Visit';
const fund = (n: string, amt = 100_000) => getBank().transfer(n, amt, { key: `fund:${n}:${Math.random()}`, game: 'admin' });
const chips = (n: string) => getBank().account(n).chips;
const games = async (n: string) => (await getBank().recent(n, 100)).map((x: { game: string }) => x.game);
const flush = () => new Promise((r) => setTimeout(r, 20));

describe('Fort McChud -> factory rides the cargo ship (trucks stay on their map)', () => {
  let now = 10 * H + 60_000; let l: Logistics; let f: FortMc; let store: Map<string, number>; let roomCap = 10_000;
  const seedFort = (ore: Partial<Record<OreId, number>>, petcoke = 0) => { const s = newFort(now); s.ore = ore; s.stock = { petcoke }; (f as unknown as { forts: Map<string, unknown> }).forts.set(playerKey(N), s); };
  beforeEach(() => {
    resetBank(); resetMines(); setPriceIndexForTest(1); now = 10 * H + 60_000; store = new Map(); roomCap = 10_000;
    l = new Logistics(null, () => now); setLogistics(l); const w = new Warehouse(null, () => now); setWarehouse(w);
    f = new FortMc(null, () => now, () => ({ room: (id) => roomCap - (store.get(id) ?? 0), write: async () => {}, after: (items) => { for (const [id, n] of items) store.set(id, (store.get(id) ?? 0) + n); } }), async () => {});
    setFortMc(f); w.wire(); fund(N, 500_000);
  });
  afterEach(() => { setLogistics(null); setPriceIndexForTest(1); });

  it('ship: fee at the price index, ledgered, owner-labelled, lands in factory storage only on arrival, exactly once', async () => {
    setPriceIndexForTest(1.37); seedFort({ iron: 140, gold: 60 }, 25);
    const c0 = chips(N);
    const r = await f.act(N, { op: 'ship', mode: 'ship' }) as { shipped: Array<[string, number]>; petcoke: number; loads: number; fee: number; arriveAt: number };
    expect(new Map(r.shipped)).toEqual(new Map([['iron', 140], ['gold', 60], ['coal', 25]])); expect(r.petcoke).toBe(25); expect(r.loads).toBe(3);
    const fee = [140, 60, 25].reduce((a, q) => a + indexed(feeBase('ship', q), 1.37), 0);
    expect(r.fee).toBe(fee); expect(chips(N)).toBe(c0 - fee); expect(await games(N)).toContain('freight');
    const inv = await f.inventory(N); expect(Math.floor(inv.ore.iron ?? 0)).toBe(0); expect(Math.floor(inv.stock.petcoke ?? 0)).toBe(0);
    expect(store.size).toBe(0); // nothing is in the factory yet: it is on the road
    const live = l.live(); expect(live).toHaveLength(1); expect(live[0]).toMatchObject({ mode: 'ship', loads: 3 });
    expect(r.arriveAt).toBeGreaterThanOrEqual(now + MODES.ship.travelMs);
    now = r.arriveAt + 1; l.tick(); await flush();
    expect(store.get('iron')).toBe(140); expect(store.get('gold')).toBe(60); expect(store.get('coal')).toBe(25); expect(l.live()).toHaveLength(0);
    const replay = { id: 'x', ownerName: N, itemId: 'iron', qty: 140 } as unknown as Shipment; // replaying a delivered id never doubles
    await f.factoryDelivered(replay); await f.factoryDelivered(replay); expect(store.get('iron')).toBe(280);
  });

  it('own and hired trucks are refused off-map (nothing moves); the default carrier is the ship; room counts loads already on the road', async () => {
    seedFort({ iron: 140, gold: 60 });
    await l.buyTruck(N, 'pickup'); const c0 = chips(N);
    for (const mode of ['truck', 'hired']) await expect(f.act(N, { op: 'ship', mode })).rejects.toThrow(/can’t haul to other maps/);
    expect(chips(N)).toBe(c0); expect(l.live()).toHaveLength(0); expect(Math.floor((await f.inventory(N)).ore.iron ?? 0)).toBe(140);
    const r = await f.act(N, { op: 'ship' }) as { loads: number; fee: number };
    expect(r.loads).toBe(2); expect(chips(N)).toBe(c0 - r.fee); expect(l.live().every((v) => v.mode === 'ship')).toBe(true);
    roomCap = 140; seedFort({ iron: 140 });
    await expect(f.act(N, { op: 'ship', mode: 'ship' })).rejects.toThrow(/Nothing to ship|storage is full/); // the 140 already on the way fill the room
  });

  it('a full factory keeps the load on the road and retries; it never lands twice', async () => {
    seedFort({ iron: 50 }); const r = await f.act(N, { op: 'ship', mode: 'ship' }) as { arriveAt: number };
    const real = f.factoryDelivered.bind(f); let fails = 1;
    l.onFactory = async (s) => { if (fails-- > 0) throw new Error('Your mine storage is full for that ore.'); return real(s); };
    now = r.arriveAt + 1; l.tick(); await flush(); expect(store.get('iron')).toBeUndefined();
    l.tick(); await flush(); expect(store.get('iron')).toBeUndefined(); // backing off: no retry yet
    now += 30_001; l.tick(); await flush(); expect(store.get('iron')).toBe(50); l.tick(); await flush(); expect(store.get('iron')).toBe(50);
  });

  it('full-factory retries back off (30 s doubling to 10 min) and log once per load', async () => {
    seedFort({ iron: 50 }); const r = await f.act(N, { op: 'ship', mode: 'ship' }) as { arriveAt: number };
    let calls = 0; l.onFactory = async () => { calls++; throw new Error('Your mine storage is full for that ore.'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    now = r.arriveAt + 1; for (let i = 0; i < 50; i++) { l.tick(); await flush(); now += 1000; } // 50 s of 1 s ticks
    expect(calls).toBe(2); // t=0 and t≈30 s; next not before t≈90 s
    now += 20 * 60_000; for (let i = 0; i < 5; i++) { l.tick(); await flush(); now += 1000; }
    expect(calls).toBe(3); expect(err.mock.calls.filter((c) => String(c[0]).includes('factory delivery')).length).toBe(1);
    err.mockRestore();
  });
});

describe('Fort McChud -> factory with a database', () => {
  it('one transaction for goods + fee + shipment rows; arrival flips transit->delivered and lands once, even from a fresh instance', async () => {
    setPriceIndexForTest(1); resetBank(); resetMines();
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool)); await pool.query(LOGISTICS_MIGRATION);
    let t = 10 * H; const l = new Logistics(pool as never, () => t); setLogistics(l);
    const store = new Map<string, number>(); const sink = () => ({ write: async (cl: { query: (q: string, a: unknown[]) => Promise<unknown> }, items: Array<[OreId, number]>) => { for (const [id, n] of items) await cl.query('SELECT $1::text, $2::int', [id, n]); }, after: (items: Array<[OreId, number]>) => { for (const [id, n] of items) store.set(id, (store.get(id) ?? 0) + n); } });
    const f = new FortMc(pool as never, () => t, sink as never, async () => {}); await f.init(); setFortMc(f);
    const w = new Warehouse(null, () => t); setWarehouse(w); w.wire();
    bank.transfer(N, 50_000, { game: 'admin' }); await bank.flush();
    const s = newFort(t); s.ore = { iron: 90 }; (f as unknown as { forts: Map<string, unknown> }).forts.set(playerKey(N), s);
    const r = await f.act(N, { op: 'ship', mode: 'ship' }) as { fee: number; arriveAt: number };
    const rows = (await pool.query("SELECT kind, status, qty, fee FROM freight_shipments")).rows; expect(rows).toEqual([{ kind: 'factory', status: 'transit', qty: 90, fee: r.fee }]);
    expect(JSON.parse((await pool.query('SELECT state FROM fortmc_state')).rows[0].state).ore.iron).toBe(0);
    t = r.arriveAt + 1; l.tick(); await flush(); await flush();
    expect(store.get('iron')).toBe(90); expect((await pool.query('SELECT status FROM freight_shipments')).rows).toEqual([{ status: 'delivered' }]);
    const sh = { id: (await pool.query('SELECT id FROM freight_shipments')).rows[0].id, ownerName: N, itemId: 'iron', qty: 90 } as unknown as Shipment;
    const f2 = new FortMc(pool as never, () => t, sink as never, async () => {}); await f2.factoryDelivered(sh); expect(store.get('iron')).toBe(90);
    setLogistics(null);
  });
});

describe('warehouse-only rule for fish and dishes', () => {
  afterEach(() => setTravel(new Travel(null)));
  it('the fishmonger and diner refuse sellers who are away at Chud Resort or Fort McChud', async () => {
    resetBank(); const t = new Travel(null); setTravel(t); fund(N, 1_000_000);
    class E extends Error {}
    expect(() => awayFromMarket(N, E)).not.toThrow();
    await t.fly(N, 'resort'); expect(() => awayFromMarket(N, E)).toThrow(MARKET_AWAY_MSG);
    await t.home?.(N).catch(() => {});
  });
  it('both sell sockets are gated', async () => {
    const fs = await import('node:fs');
    expect(fs.readFileSync('server/fishing.ts', 'utf8')).toMatch(/on\('fish_sell', \(b, f, n\) => \{ awayFromMarket\(n, FishError\)/);
    expect(fs.readFileSync('server/cooking.ts', 'utf8')).toMatch(/on\('cook_sell', \(b, c, n\) => \{ awayFromMarket\(n, CookError\)/);
  });
});

describe('fee preview includes the price index', () => {
  afterEach(() => setPriceIndexForTest(1));
  it('shipFee (client previews) equals Logistics.quote (what is charged)', () => {
    const l = new Logistics(null);
    for (const idx of [1, 1.37, 0.82]) { setPriceIndexForTest(idx); for (const m of ['hired', 'plane', 'ship', 'truck'] as const) for (const q of [1, 100, 1800]) expect(shipFee(m, q, idx)).toBe(l.quote(m, q)); }
    expect(shipFee('hired', 1800, 1.37)).toBe(Math.round(feeBase('hired', 1800) * 1.37));
  });
});
