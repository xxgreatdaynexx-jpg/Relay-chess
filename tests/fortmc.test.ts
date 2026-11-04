// Fort McChud: generic travel (ticket + waiver hook), oil & gas sim, Deep Ore Mine, sales tiers, ledger + Postgres.
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getBank, resetBank, isChipEvent } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { Travel, setTravel, isAtFortMc, isAtResort, setTicketWaiver } from '../server/travel';
import { FortMc } from '../server/fortmc';
import { SINK_DEBIT_GAMES } from '../shared/sinkRoom';
import {
  newFort, settle, step, tractInfo, sellPayout, efficiency, repairCost, powerDemand, MINE_LEVELS, UNITS, STEP_MS, MAX_CATCHUP_MS,
  GRID_MW, TRACTS, ORE_VALUE_PER_UNIT, PRODUCTS, type FortState,
} from '../shared/fortmc';
import { DESTINATIONS } from '../shared/resort';

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; };
  return { query: q, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}
const seed = (n: string, chips: number) => { const b = getBank(); b.transfer(n, chips - b.account(n).chips, { game: 'admin' }); };
const H = 3600_000;

describe('travel to Fort McChud', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); setTravel(new Travel(null)); setTicketWaiver(null); });
  it('ticket px(1500), ledger game fortmc_ticket (a sink), free return, resort still works', async () => {
    const t = new Travel(null); setTravel(t); seed('QA-Fort', 5000);
    expect(t.status('QA-Fort').tickets).toEqual({ resort: 500, fortmc: 1500 });
    const r = await t.fly('QA-Fort', 'fortmc'); expect(r.fee).toBe(1500); expect(getBank().account('QA-Fort').chips).toBe(3500);
    expect(isAtFortMc('QA-Fort')).toBe(true); expect(isAtResort('QA-Fort')).toBe(false);
    expect((await getBank().recent('QA-Fort', 5)).some((x: { game: string }) => x.game === 'fortmc_ticket')).toBe(true);
    await expect(t.fly('QA-Fort', 'fortmc')).rejects.toThrow(/already at Fort McChud/);
    await t.fly('QA-Fort', 'resort'); expect(isAtResort('QA-Fort')).toBe(true);
    await t.home('QA-Fort'); expect(t.where('QA-Fort')).toBe('city');
    expect(SINK_DEBIT_GAMES.has(DESTINATIONS.fortmc.game)).toBe(true); expect(SINK_DEBIT_GAMES.has('fortmc')).toBe(false);
    expect(isChipEvent('fort_act')).toBe(true);
    await expect(t.fly('QA-Fort', 'mars' as never)).rejects.toThrow(/Unknown destination/);
  });
  it('ticket waiver hook (private jets) skips the charge for any destination', async () => {
    const t = new Travel(null); setTravel(t); seed('QA-Jet', 0);
    setTicketWaiver((n) => (n === 'QA-Jet' ? 'Private jet' : null));
    expect(t.status('QA-Jet').tickets.fortmc).toBe(0);
    const r = await t.fly('QA-Jet', 'fortmc'); expect(r.fee).toBe(0); expect(r.waived).toBe('Private jet'); expect(isAtFortMc('QA-Jet')).toBe(true);
  });
  it('location persists on Postgres for every destination', async () => {
    const db = new PGlite(); const t = new Travel(shim(db) as never); await t.init(); seed('QA-FPg', 5000);
    await t.fly('QA-FPg', 'fortmc'); const t2 = new Travel(shim(db) as never); await t2.init(); expect(t2.where('QA-FPg')).toBe('fortmc');
  });
});

/** A mid-size fort: 3 tracts × 4 wells with pumpjacks on tier-2 pipe + the full downstream chain. */
function bigFort(): FortState {
  const s = newFort(0);
  for (const n of [1, 2, 3]) s.tracts[String(n)] = { leased: true, pipe: 2, wells: Array.from({ length: 4 }, () => ({ jack: true, cond: 100 })) };
  const add = (k: keyof typeof UNITS, n: number) => { for (let i = 0; i < n; i++) s.units.push({ id: ++s.seq, k, cond: 100, on: true }); };
  add('separator', 3); add('gas_plant', 2); add('refinery', 4); add('reformer', 2); add('coker', 2); add('cracker', 1); add('polymer', 1); add('turbine', 4); add('tank', 6);
  return s;
}

describe('oil & gas sim', () => {
  it('tracts are deterministic and in range', () => {
    for (let n = 1; n <= TRACTS; n++) { const t = tractInfo(n); expect(t).toEqual(tractInfo(n)); expect(t.richness).toBeGreaterThanOrEqual(0.6); expect(t.richness).toBeLessThanOrEqual(1.4); expect(t.gas + 0.15).toBeLessThan(1); }
  });
  it('nothing flows without a pipeline; power limits throttle; grid alone runs a starter site', () => {
    const s = newFort(0); s.tracts['1'] = { leased: true, pipe: 0, wells: [{ jack: false, cond: 100 }] }; settle(s, 2 * H);
    expect(s.stock.wellstream ?? 0).toBe(0);
    s.tracts['1']!.pipe = 1; s.units.push({ id: 1, k: 'separator', cond: 100, on: true }); settle(s, 4 * H);
    expect(s.stock.crude ?? 0).toBeGreaterThan(0); expect(s.stock.rawgas ?? 0).toBeGreaterThan(0);
    const big = bigFort(); expect(powerDemand(big)).toBeGreaterThan(GRID_MW); step(big); expect(big.power.supply).toBe(GRID_MW); // no gas yet: turbines idle
  });
  it('full chain makes every product over a day and reaches steady power from its own gas', () => {
    const s = bigFort(); settle(s, 24 * H);
    for (const p of ['crude', 'natgas', 'ngl', 'naphtha', 'diesel', 'gasoline', 'residue', 'petcoke', 'sulfur', 'ethylene', 'plastic'] as const) expect(s.made[p] ?? 0, p).toBeGreaterThan(0);
    expect(s.power.supply).toBeGreaterThan(GRID_MW);
    const value = Object.entries(s.stock).reduce((a, [p, n]) => a + PRODUCTS[p as keyof typeof PRODUCTS].price * (n ?? 0), 0);
    console.log('[fortmc-day]', Math.round(value), JSON.stringify(s.power), JSON.stringify(Object.fromEntries(Object.entries(s.stock).map(([k, v]) => [k, Math.round(v!)]))));
    expect(value).toBeGreaterThan(50_000); expect(value).toBeLessThan(400_000);
  });
  it('tanks fill and back the chain up; catch-up is capped at 24h', () => {
    const s = bigFort(); s.units = s.units.filter((u) => u.k !== 'tank'); settle(s, 72 * H);
    expect(s.at).toBe(72 * H); for (const v of Object.values(s.stock)) expect(v!).toBeLessThanOrEqual(400 + 1e-6);
    expect(settle(newFort(0), 10 * 24 * H)).toBe(MAX_CATCHUP_MS / STEP_MS);
  });
  it('wear slows then stops units; repairs cost a share of the build', () => {
    expect(efficiency(100)).toBe(1); expect(efficiency(30)).toBe(0.5); expect(efficiency(10)).toBe(0);
    expect(repairCost(100_000, 0)).toBe(15_000); expect(repairCost(100_000, 100)).toBe(0);
    const s = bigFort(); for (let d = 0; d < 6; d++) settle(s, (d + 1) * 24 * H);
    expect(Math.min(...s.units.filter((u) => u.k === 'refinery').map((u) => u.cond))).toBeLessThan(100);
  });
  it('mine is very expensive and digs the ore mix', () => {
    expect(MINE_LEVELS[0]!.cost).toBe(2_500_000);
    const s = newFort(0); s.mine = { level: 1, cond: 100, on: true }; s.units.push({ id: 1, k: 'tank', cond: 100, on: true });
    for (let i = 0; i < 3; i++) s.units.push({ id: 2 + i, k: 'turbine', cond: 100, on: true });
    s.stock.natgas = 1500; settle(s, 2 * H);
    expect(s.ore.coal ?? 0).toBeGreaterThan(100); expect(s.ore.diamond ?? 0).toBeGreaterThan(0);
    const daily = MINE_LEVELS[0]!.rate * 24 * ORE_VALUE_PER_UNIT; console.log('[fortmc-mine] raw ore value/day', Math.round(daily), 'payback days', Math.round(2_500_000 / daily));
    expect(2_500_000 / daily).toBeGreaterThan(30);
  });
  it('sale tiers', () => {
    expect(sellPayout(100_000, 0)).toBe(100_000); expect(sellPayout(100_000, 100_000)).toBe(50_000 + 20_000);
    expect(sellPayout(100_000, 500_000)).toBe(10_000);
  });
});

describe('FortMc server', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  it('requires being at the fort; survey -> lease -> drill -> pipe -> build -> produce -> sell; ledger games', async () => {
    const clk = { now: 1_000_000 }; let here = false;
    const f = new FortMc(null, () => clk.now, () => ({ write: async () => {}, after: () => {} }), async () => { if (!here) throw new Error('away'); });
    const n = 'QA-Oil'; seed(n, 500_000);
    await expect(f.act(n, { op: 'survey', tract: 1 })).rejects.toThrow(); here = true;
    await expect(f.act(n, { op: 'lease', tract: 1 })).rejects.toThrow(/Survey/);
    await f.act(n, { op: 'survey', tract: 1 }); await f.act(n, { op: 'lease', tract: 1 });
    await f.act(n, { op: 'drill', tract: 1 }); await f.act(n, { op: 'drill', tract: 1 }); await f.act(n, { op: 'pipe', tract: 1 });
    await f.act(n, { op: 'build', kind: 'separator' });
    await expect(f.act(n, { op: 'mine' })).rejects.toThrow(/Not enough chips/);
    const spent = 2_500 + tractInfo(1).lease + 2 * 45_000 + 15_000 + 60_000; expect(getBank().account(n).chips).toBe(500_000 - spent);
    clk.now += 6 * H; const v = await f.view(n); expect(v.fort.stock.crude ?? 0).toBeGreaterThan(10);
    await expect(f.act(n, { op: 'sell', items: [['wellstream', 5]] })).rejects.toThrow(/process it first/);
    const r = await f.act(n, { op: 'sell', items: [['crude', 10]] }) as { paid: number }; expect(r.paid).toBe(50);
    const games = (await getBank().recent(n, 50)).map((x: { game: string }) => x.game); expect(games).toContain('fortmc'); expect(games).toContain('fortmc_sale');
    clk.now += 20 * H; await f.act(n, { op: 'repair', what: 'all' }); expect((await getBank().recent(n, 1))[0]!.game).toBe('fortmc_upkeep');
  });
  it('Postgres: state + ledger in one transaction, reload, ship ore into a sink', async () => {
    const db = new PGlite(); const clk = { now: 5_000_000 }; const shipped: unknown[] = [];
    const sink = () => ({ write: async (cl: { query: (s: string, a?: unknown[]) => Promise<unknown> }, items: unknown[]) => { await cl.query('SELECT 1'); shipped.push(...items); }, after: () => {} });
    const f = new FortMc(shim(db) as never, () => clk.now, sink as never, async () => {}); await f.init(); await f.init();
    const n = 'QA-Mine'; seed(n, 9_000_000);
    await f.act(n, { op: 'build', kind: 'tank' }); await f.act(n, { op: 'mine' });
    for (let i = 0; i < 2; i++) await f.act(n, { op: 'build', kind: 'turbine' });
    expect(getBank().account(n).chips).toBe(9_000_000 - 25_000 - 2_500_000 - 180_000);
    clk.now += 2 * H;
    const f2 = new FortMc(shim(db) as never, () => clk.now, sink as never, async () => {}); await f2.init();
    const v = await f2.view(n); expect(v.fort.mine?.level).toBe(1); expect(v.fort.ore.iron ?? 0).toBeGreaterThan(10); // grid 4 MW < 10 MW: throttled but digging
    await f2.act(n, { op: 'ship' }); expect(shipped.length).toBeGreaterThan(3);
    expect((await f2.view(n)).fort.ore.iron ?? 0).toBeLessThan(1);
  }, 30_000);
});
