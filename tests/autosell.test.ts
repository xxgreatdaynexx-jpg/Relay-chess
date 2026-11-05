// Millionaire Update: building inventories, ship-to-sell at the Chud City Warehouse, auto-sell.
import { fortSellPrice } from '../shared/sellBuff';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newDb } from 'pg-mem';
import { getBank, resetBank, CasinoBank, PgCasinoStore } from '../server/casino-store';
import { getMines, resetMines } from '../server/mines';
import { setPriceIndexForTest } from '../server/price-index';
import { Logistics, setLogistics, LOGISTICS_MIGRATION, type Shipment } from '../server/logistics';
import { FortMc, setFortMc } from '../server/fortmc';
import { Farm, setFarm } from '../server/farm';
import { RealEstate } from '../server/realEstate';
import { Warehouse, setWarehouse, recipeNeeds } from '../server/warehouse';
import { WAREHOUSE_MIGRATION, binAddStmt, saleLogStmt } from '../server/warehouse-log';
import { AUTO_MIN_LOAD, autoCarrier, autoQty } from '../shared/autosell';
import { feeBase, MODES } from '../shared/logistics';
import { PRODUCTS, sellPayout } from '../shared/fortmc';
import { cropById } from '../shared/farm';

const H = 3_600_000;
const fund = (n: string, amt = 100_000) => getBank().transfer(n, amt, { key: `fund:${n}:${Math.random()}`, game: 'admin' });
const chips = (n: string) => getBank().account(n).chips;
const games = async (n: string) => (await getBank().recent(n, 100)).map((x: { game: string }) => x.game);

describe('auto-sell rules', () => {
  it('reserve, minimum load and keep-for-recipes', () => {
    const on = { on: true, reserve: 30, keepRecipe: true };
    expect(autoQty(100, on, false)).toBe(70);
    expect(autoQty(70, on, false)).toBe(0); // 40 above reserve < min load
    expect(autoQty(100, on, true)).toBe(0); // kept for recipes
    expect(autoQty(100, { ...on, keepRecipe: false }, true)).toBe(70);
    expect(autoQty(1000, { ...on, on: false }, false)).toBe(0);
    expect(AUTO_MIN_LOAD).toBe(50);
  });
  it('carrier: idle own truck first (free), hired only when the fee is <= 40% of the load value, else wait', () => {
    const hiredFee = (q: number) => feeBase('hired', q);
    expect(autoCarrier({ idleTruckCap: 250, qty: 400, value: 400, hiredFee, hiredCap: MODES.hired.cap })).toEqual({ mode: 'truck', qty: 250 });
    expect(autoCarrier({ idleTruckCap: null, qty: 100, value: 100 * 16, hiredFee, hiredCap: MODES.hired.cap })).toEqual({ mode: 'hired', qty: 100 });
    expect(autoCarrier({ idleTruckCap: null, qty: 100, value: 100 * 2, hiredFee, hiredCap: MODES.hired.cap })).toBeNull(); // natgas at 2/unit: fee 200 > 80
  });
  it('recipe needs come from the real recipe books', () => {
    expect(recipeNeeds('ore', 'iron')).toBe(true); expect(recipeNeeds('ore', 'coal')).toBe(true);
    expect(recipeNeeds('crop', 'wheat')).toBe(true);
  });
});

describe('ship-to-sell + warehouse', () => {
  let now = 10 * H + 60_000; let l: Logistics; let w: Warehouse;
  beforeEach(() => {
    resetBank(); resetMines(); setPriceIndexForTest(1); now = 10 * H + 60_000;
    l = new Logistics(null, () => now); setLogistics(l); w = new Warehouse(null, () => now); setWarehouse(w); w.wire();
  });
  afterEach(() => { setLogistics(null); getMines().coralBin = null; });

  it('Fort McChud: no direct sale; ship & sell -> fee ledgered, labelled truck, sells on arrival exactly once', async () => {
    const clk = { now: 1_000_000 };
    const f = new FortMc(null, () => clk.now, () => ({ write: async () => {}, after: () => {} }), async () => {}); setFortMc(f);
    const n = 'QA-Cole-Visit'; fund(n, 500_000);
    await f.act(n, { op: 'survey', tract: 1 }); await f.act(n, { op: 'lease', tract: 1 }); await f.act(n, { op: 'drill', tract: 1 }); await f.act(n, { op: 'drill', tract: 1 });
    await f.act(n, { op: 'pipe', tract: 1 }); await f.act(n, { op: 'build', kind: 'separator' });
    clk.now += 12 * H; const crude = Math.floor((await f.inventory(n)).stock.crude ?? 0); expect(crude).toBeGreaterThan(100);
    await expect(f.act(n, { op: 'sell', items: [['crude', 10]] })).rejects.toThrow(/no market/);
    await expect(f.act(n, { op: 'ship_sell', id: 'crude', qty: crude + 5, mode: 'hired' })).rejects.toThrow(/that much/);
    const c0 = chips(n);
    const r = await f.act(n, { op: 'ship_sell', id: 'crude', qty: 100, mode: 'hired' }) as { fee: number; shipment: string };
    expect(r.fee).toBe(feeBase('hired', 100)); expect(chips(n)).toBe(c0 - r.fee);
    expect(Math.floor((await f.inventory(n)).stock.crude ?? 0)).toBe(crude - 100);
    expect(await games(n)).toContain('freight');
    const live = l.live(); expect(live).toHaveLength(1); expect(live[0]!.label).toBe(`Hired rig · ${n} · to market`);
    now += MODES.hired.travelMs + 1; l.tick(); await new Promise((res) => setTimeout(res, 20));
    const pay = sellPayout(Math.floor(100 * fortSellPrice('crude')), 0);
    expect(chips(n)).toBe(c0 - r.fee + pay); expect(await games(n)).toContain('fortmc_sale');
    expect(l.live()).toHaveLength(0);
    // idempotent: replaying the arrival never pays twice
    await w.arrived({ id: r.shipment, owner: 'qa-cole-visit', ownerName: n, type: 'fort', itemId: 'crude', qty: 100 } as unknown as Shipment);
    expect(chips(n)).toBe(c0 - r.fee + pay);
  });

  it('Coral Grotto bin: hauls stay at the grotto; ship & sell lands at the Warehouse and sells there', async () => {
    const n = 'QA-Cole-Visit'; fund(n, 10_000);
    w.binRows(n, 'coral', [['ore:gold', 120]]);
    expect((await w.inventory(n, 'coral'))[0]).toMatchObject({ key: 'ore:gold', qty: 120 });
    expect(getMines().stackQty(n, 'ore', 'gold')).toBe(0); // not in the global warehouse
    const c0 = chips(n);
    const r = await w.shipSell(n, 'coral', 'ore:gold', 100, 'hired');
    expect(chips(n)).toBe(c0 - r.fee); expect((await w.bin(n, 'coral')).get('ore:gold')).toBe(20);
    await expect(w.shipSell(n, 'coral', 'ore:gold', 21, 'hired')).rejects.toThrow(/that much/);
    expect(l.live()[0]!.label).toMatch(/Hired rig · QA-Cole-Visit · to market/);
    now += MODES.hired.travelMs + 1; l.tick(); await new Promise((res) => setTimeout(res, 20));
    expect(chips(n)).toBeGreaterThan(c0 - r.fee); expect(await games(n)).toContain('mines');
    const log = await w.log(n); expect(log[0]).toMatchObject({ building: 'coral', item: 'gold', qty: 100, status: 'sold', auto: false });
  });

  it('auto-sell sweep: respects reserve + recipe keep, uses the own truck first, label says auto-sell', async () => {
    const n = 'QA-Cole-Visit'; fund(n, 50_000); await l.buyTruck(n, 'pickup');
    w.binRows(n, 'coral', [['ore:gold', 120], ['ore:iron', 300]]);
    await w.setCfg(n, 'coral', 'ore:gold', { on: true, reserve: 100 });
    expect(await w.sweep(n)).toEqual([]); // only 20 above reserve
    await w.setCfg(n, 'coral', 'ore:gold', { reserve: 10 });
    await w.setCfg(n, 'coral', 'ore:iron', { on: true, keepRecipe: true });
    const out = await w.sweep(n);
    expect(out).toEqual([{ building: 'coral', item: 'ore:gold', qty: 110, mode: 'truck' }]); // iron kept for smelting
    expect(l.live()[0]!.label).toBe(`${n}'s Chud Pickup · auto-sell`);
    expect((await w.bin(n, 'coral')).get('ore:gold')).toBe(10);
    await expect(w.setCfg(n, 'coral', 'ore:gold', { reserve: -1 })).rejects.toThrow(/Reserve/);
    await expect(w.setCfg(n, 'nowhere', 'ore:gold', {})).rejects.toThrow(/building/);
  });
});

describe('Postgres', () => {
  it('migrations are additive + idempotent on pglite (Neon dialect); bins accumulate', async () => {
    const db = new PGlite();
    for (let i = 0; i < 2; i++) { await db.exec(LOGISTICS_MIGRATION); await db.exec(WAREHOUSE_MIGRATION); }
    const cols = (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'freight_shipments'`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(['kind', 'src', 'auto']));
    for (const q of [40, 2]) { const s = binAddStmt('k', 'K', 'coral', 'ore:gold', q); await db.query(s.sql, s.args); }
    expect((await db.query<{ qty: number }>('SELECT qty FROM building_inv')).rows[0]!.qty).toBe(42);
    const sh = { id: 'x1', owner: 'k', ownerName: 'K', src: 'coral', from: 'resort', type: 'ore', itemId: 'gold', qty: 5, fee: 25, auto: true } as unknown as Shipment;
    await db.query(saleLogStmt(sh, 'stored', 0, null).sql, saleLogStmt(sh, 'stored', 0, null).args);
    await db.query(saleLogStmt(sh, 'sold', 90, null).sql, saleLogStmt(sh, 'sold', 90, null).args);
    expect((await db.query<{ status: string; paid: number }>('SELECT status, paid FROM warehouse_sales')).rows).toEqual([{ status: 'sold', paid: 90 }]);
  });

  it('Resort plantation: harvest goes into the barn (no chips at the field); shipped crops pay once via farm_harvest', async () => {
    setPriceIndexForTest(1); resetBank();
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    let t = Date.parse('2026-11-01T12:00:00Z');
    const re = new RealEstate(pool, () => bank, () => t); await re.init();
    const farm = new Farm(pool, () => bank, () => t); await farm.init(); setFarm(farm);
    const w = new Warehouse(pool as never, () => t); await w.init(); setWarehouse(w); farm.barn = null; w.wire();
    await pool.query(LOGISTICS_MIGRATION);
    bank.transfer('QA-Cole-Visit', 50_000, { game: 'admin' }); await bank.flush();
    await re.buy('QA-Cole-Visit', 'rf:1'); await farm.plow('QA-Cole-Visit', 'rf:1', [0, 1]); await farm.plant('QA-Cole-Visit', 'rf:1', 'coconut', [0, 1]);
    const before = bank.account('QA-Cole-Visit').chips; t += cropById('coconut')!.grow + 1;
    const h = await farm.harvest('QA-Cole-Visit', 'rf:1') as { paid: number; toBarn: Array<[string, number]> };
    expect(h.paid).toBe(0); expect(bank.account('QA-Cole-Visit').chips).toBe(before);
    const got = (await w.bin('QA-Cole-Visit', 'resort_farm')).get('crop:coconut') ?? 0; expect(got).toBeGreaterThanOrEqual(2);
    const sh = { id: 'ship-1', owner: 'qa-cole-visit', ownerName: 'QA-Cole-Visit', toKey: 'qa-cole-visit', toName: 'QA-Cole-Visit', src: 'resort_farm', from: 'resort', to: 'city', type: 'crop', itemId: 'coconut', qty: 2, fee: 0, mode: 'truck', truck: null, createdAt: t, departAt: t, arriveAt: t, status: 'transit', kind: 'sell', auto: true } as unknown as Shipment;
    const rows = [saleLogStmt(sh, 'sold', 0, null)];
    const paid = await farm.sellShipped(sh, rows); const c = cropById('coconut')!; expect(paid).toBe(Math.floor(2 * c.sell * 0.9025)); // farming -5%
    expect(await farm.sellShipped(sh, rows)).toBe(0); // replay: ledger key whsale:ship-1 already used
    expect(bank.account('QA-Cole-Visit').chips).toBe(before + paid);
    const log = (await pool.query('SELECT paid, status FROM warehouse_sales')).rows; expect(log).toEqual([{ paid, status: 'sold' }]);
    setFarm(null);
  });
});
