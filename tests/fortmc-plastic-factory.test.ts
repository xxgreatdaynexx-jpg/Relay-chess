// Fort McChud plastics can be shipped to the factory, landing as plastic resin for the new plastic recipes.
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getBank, resetBank } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { FortMc, FORTMC_MIGRATION } from '../server/fortmc';
import { Logistics, setLogistics, LOGISTICS_MIGRATION } from '../server/logistics';
import { newFort } from '../shared/fortmc';
import { FRECIPES, recipeIn, recipeOut } from '../shared/factory';
import { FORT_IMPORT } from '../shared/plasticsPlant';

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; };
  return { query: q, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}

beforeEach(() => { resetBank(); setPriceIndexForTest(1); });

describe('Fort McChud plastics to the factory', () => {
  it('ships tank plastics by cargo ship; they land once as plastic resin in factory storage', async () => {
    const db = new PGlite(); const clk = { now: 5_000_000 };
    await db.exec(FORTMC_MIGRATION);
    const n = 'QA-Poly'; const st = newFort(clk.now); st.stock.plastic = 120;
    await db.query('INSERT INTO fortmc_state (player_key, name, state, updated_at) VALUES ($1,$2,$3,$4)', ['qa-poly', n, JSON.stringify(st), clk.now]);
    const landed: Array<[string, number]> = [];
    const goodSink = () => ({ room: () => 1_000_000, write: async (cl: { query: (s: string) => Promise<unknown> }, items: Array<[string, number]>) => { await cl.query('SELECT 1'); landed.push(...items); }, after: () => {} });
    const oreSink = () => ({ write: async () => {}, after: () => {} });
    const f = new FortMc(shim(db) as never, () => clk.now, oreSink as never, async () => {}, goodSink as never); await f.init();
    getBank().transfer(n, 1_000_000, { game: 'admin' });
    await db.exec(LOGISTICS_MIGRATION); const lg = new Logistics(shim(db) as never, () => clk.now); setLogistics(lg); lg.onFactory = (s) => f.factoryDelivered(s);
    const r = await f.act(n, { op: 'ship', what: 'plastic', mode: 'ship' }) as { fee: number; arriveAt: number; resin: number; loads: number };
    expect(r.resin).toBe(120 * FORT_IMPORT.plastic.qty); expect(r.fee).toBeGreaterThan(0);
    expect((await f.view(n)).fort.stock.plastic ?? 0).toBeLessThan(1);
    expect(landed).toHaveLength(0); // nothing lands before the ship arrives
    await expect(f.act(n, { op: 'ship', what: 'plastic', mode: 'ship' })).rejects.toThrow(/No plastics/);
    clk.now = r.arriveAt + 1; lg.tick(); for (let i = 0; i < 40 && landed.length < r.loads; i++) await new Promise((res) => setTimeout(res, 50));
    expect(landed.reduce((a, [id, q]) => a + (id === 'plastic_resin' ? q : 0), 0)).toBe(120);
    lg.tick(); await new Promise((res) => setTimeout(res, 100));
    expect(landed.reduce((a, [, q]) => a + q, 0)).toBe(120); // exactly once
    setLogistics(null);
  }, 30_000);

  it('factory recipes use plastic resin at the usual step margin', () => {
    const plastic = FRECIPES.filter((r) => r.in.some(([k]) => k === 'good:plastic_resin'));
    expect(plastic.map((r) => r.id).sort()).toEqual(['a_plastic_crate', 'a_pvc_pipe', 'd_insulated_cable', 'f_appliance']);
    for (const r of plastic) { const k = recipeOut(r) / recipeIn(r); expect(k, r.id).toBeGreaterThanOrEqual(1.2); expect(k, r.id).toBeLessThanOrEqual(1.4); }
  });
});
