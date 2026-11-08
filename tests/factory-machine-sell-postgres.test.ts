/** t1967u: selling a placed factory machine, against REAL PostgreSQL (own throwaway database on the local test server). */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { PgMineStore, resetMines, type MinesWorld } from '../server/mines';
import { resetFactory, type FactoryWorld } from '../server/factory';
import { PgCasinoStore, getBank, resetBank } from '../server/casino-store';
import { KINDS, machineSalePrice, MACHINE_RESALE_RATE } from '../shared/factory';
import { PI_FLOOR, indexed } from '../shared/priceIndex';

const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
let root: pg.Client; let pool: pg.Pool; let dbName = '';
let w: MinesWorld; let f: FactoryWorld; let n = 0;
const T0 = Date.UTC(2026, 10, 7, 18, 0, 0); // 12:00 UTC-6, awake hours
beforeAll(async () => {
  if (!url) return; const u = new URL(url); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only');
  dbName = `facsell_${process.pid}_${Date.now()}`; root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${dbName}`);
  u.pathname = `/${dbName}`; pool = new pg.Pool({ connectionString: u.toString(), max: 6 });
});
afterAll(async () => { if (!url) return; await pool.end(); await root.query(`DROP DATABASE ${dbName}`); await root.end(); }); // only our own throwaway DB
async function boot() { if (f) { await f.flush(); await w.flush(); await getBank().flush?.(); } const b = resetBank(); b.retryMs = []; await b.attach(new PgCasinoStore(pool)); w = resetMines(); await w.attach(new PgMineStore(pool)); f = resetFactory(); }
beforeEach(async () => { if (url) await boot(); });
afterEach(async () => { vi.restoreAllMocks(); if (url) { await f.flush(); await w.flush(); await getBank().flush?.(); } });
const bal = (a: string) => getBank().account(a).chips;
const dbChips = async (a: string) => Number((await pool.query('SELECT chips FROM casino_players WHERE player_key = $1', [a.toLowerCase()])).rows[0]?.chips);
const sales = async (a: string) => (await pool.query("SELECT tx_key, amount FROM wallet_transactions WHERE player_key = $1 AND tx_key LIKE 'factory:sell:%'", [a.toLowerCase()])).rows;
const dbEnts = async (a: string) => ((await pool.query('SELECT data FROM factory_v2 WHERE player_key = $1', [a.toLowerCase()])).rows[0]?.data?.ents ?? []) as Array<{ id: number; k: string }>;
/** A: factory with chests, belts, a smelter (starter kit) and a bought press, plus banked ore. */
async function setup() {
  const A = `qa-sell-${++n}`; getBank().transfer(A, 5000 - bal(A), { game: 'test', key: `seed:${A}` });
  f.expand(A, T0); f.buy(A, 'press', 1, T0);
  f.place(A, [{ k: 'chest_in', x: 0, y: 0, d: 0 }, { k: 'belt', x: 1, y: 0, d: 0 }, { k: 'smelter', x: 2, y: 0, d: 0 }, { k: 'press', x: 6, y: 0, d: 0 }, { k: 'chest_out', x: 9, y: 0, d: 0 }], T0);
  w.packOf(A).set('ore:iron', { type: 'ore', id: 'iron', qty: 40 }); w.packOf(A).set('good:gear', { type: 'good', id: 'gear', qty: 3 });
  await f.flush(); await w.flush(); await getBank().flush?.();
  const s = f.get(A, T0)!; const id = (k: string) => s.ents.find((e) => e.k === k)!.id;
  return { A, s, id };
}
const snap = (A: string) => { const s = f.get(A, T0)!; return { ents: s.ents.map((e) => `${e.id}:${e.k}:${e.x},${e.y}`), kit: { ...s.kit }, pack: [...w.packOf(A).values()].map((x) => `${x.id}:${x.qty}`).sort() }; };

describe.skipIf(!url)('factory machine sale (real Postgres)', () => {
  it('resale formula: half the base price, never above half of anything ever paid (index floor 1.0)', () => {
    expect(MACHINE_RESALE_RATE).toBe(0.5); expect(PI_FLOOR).toBe(1);
    for (const k of Object.keys(KINDS) as Array<keyof typeof KINDS>) {
      const pay = machineSalePrice(k);
      if (!KINDS[k].machine) { expect(pay).toBe(0); continue; }
      expect(pay).toBe(Math.floor(KINDS[k].cost / 2));
      for (const idx of [1, 1.03, 2, 10]) expect(pay * 2).toBeLessThanOrEqual(indexed(KINDS[k].cost, idx)); // round trip always loses >= 50%
    }
  });
  it('owner sells an idle machine: credited once, one atomic commit, other ids/stock/kit untouched, survives restart', async () => {
    const { A, id } = await setup(); const before = snap(A); const c0 = bal(A); const smelter = id('smelter');
    expect(f.sellQuote(A, smelter, T0).pay).toBe(100);
    expect(await f.sell(A, { id: smelter, kind: 'smelter', quote: 100 }, T0)).toEqual({ sold: smelter, kind: 'smelter', paid: 100 });
    expect(bal(A)).toBe(c0 + 100);
    const after = snap(A);
    expect(after.ents).toEqual(before.ents.filter((x) => !x.startsWith(`${smelter}:`))); // remaining ids/positions stable, not re-indexed
    expect(after.kit).toEqual(before.kit); expect(after.pack).toEqual(before.pack);
    expect((await dbEnts(A)).map((e) => e.id)).not.toContain(smelter);
    expect(await sales(A)).toHaveLength(1); expect(Number((await sales(A))[0].amount)).toBe(100);
    expect(await dbChips(A)).toBe(c0 + 100);
    await boot(); // restart from the database
    expect(f.get(A, T0)!.ents.map((e) => e.id)).toEqual(after.ents.map((x) => Number(x.split(':')[0])));
    expect(bal(A)).toBe(c0 + 100);
  });
  it('no auth, other player, missing id, non-machine, stale kind, wrong quote: refused, nothing changes', async () => {
    const { A, id } = await setup(); const before = snap(A); const c0 = bal(A); const sm = id('smelter');
    await expect(f.sell(null, { id: sm, kind: 'smelter', quote: 100 }, T0)).rejects.toThrow(/Sign in/);
    const B = `qa-other-${n}`; getBank().transfer(B, 1000, { game: 'test', key: `seed:${B}` }); f.expand(B, T0);
    await expect(f.sell(B, { id: sm, kind: 'smelter', quote: 100 }, T0)).rejects.toThrow(/not in your factory/);
    await expect(f.sell(A, { id: 99999, kind: 'smelter', quote: 100 }, T0)).rejects.toThrow(/not in your factory/);
    await expect(f.sell(A, { id: id('belt'), kind: 'belt', quote: 1 }, T0)).rejects.toThrow(/not a machine/);
    await expect(f.sell(A, { id: sm, kind: 'press', quote: 100 }, T0)).rejects.toThrow(/selection changed/);
    await expect(f.sell(A, { id: sm, kind: 'smelter', quote: 999 }, T0)).rejects.toThrow(/price is 100/);
    expect(snap(A)).toEqual(before); expect(bal(A)).toBe(c0); expect(await sales(A)).toHaveLength(0);
  });
  it('busy machine refused; its inputs, output and progress are preserved', async () => {
    const { A, s, id } = await setup(); const before = snap(A); const c0 = bal(A);
    const press = s.ents.find((e) => e.id === id('press'))!; press.r = 'p_iron_plate'; press.ib = { 'bar:iron_bar': 1 };
    await expect(f.sell(A, { id: press.id, kind: 'press', quote: 200 }, T0)).rejects.toThrow(/still working or holding items/);
    expect(press.ib).toEqual({ 'bar:iron_bar': 1 });
    press.ib = {}; press.p = 3; expect(() => f.sellQuote(A, press.id, T0)).toThrow(/still working/); expect(press.p).toBe(3);
    press.p = 0; press.ob = 2; expect(() => f.sellQuote(A, press.id, T0)).toThrow(/still working/); expect(press.ob).toBe(2);
    expect(snap(A).ents).toEqual(before.ents); expect(bal(A)).toBe(c0); expect(await sales(A)).toHaveLength(0);
  });
  it('double click / retry / concurrent sale: credited exactly once', async () => {
    const { A, id } = await setup(); const c0 = bal(A); const sm = id('smelter'); const b = { id: sm, kind: 'smelter', quote: 100 };
    const r = await Promise.allSettled([f.sell(A, b, T0), f.sell(A, b, T0), f.sell(A, b, T0 + 1)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    await expect(f.sell(A, b, T0 + 5)).rejects.toThrow(/not in your factory/); // retry after success
    expect(bal(A)).toBe(c0 + 100); expect(await sales(A)).toHaveLength(1); expect(await dbChips(A)).toBe(c0 + 100);
  });
  it('race with start (recipe set), pick-up and upgrade: refused while the sale commits; after it the machine is gone', async () => {
    const { A, id } = await setup(); const sm = id('smelter'); const c0 = bal(A);
    const p = f.sell(A, { id: sm, kind: 'smelter', quote: 100 }, T0);
    expect(() => f.edit(A, { id: sm, r: 's_iron' }, T0)).toThrow(/Finishing your machine sale/);
    expect(() => f.remove(A, [sm], T0)).toThrow(/Finishing your machine sale/);
    expect(() => f.expand(A, T0)).toThrow(/Finishing your machine sale/);
    await p;
    expect(() => f.edit(A, { id: sm, r: 's_iron' }, T0)).toThrow(/Nothing there/);
    expect(() => f.remove(A, [sm], T0)).toThrow(/Nothing there/);
    expect(f.get(A, T0)!.kit.smelter ?? 0).toBe(0); // not duplicated into the kit
    expect(bal(A)).toBe(c0 + 100);
  });
  it('a failed commit restores the machine and reverts the credit (never one without the other)', async () => {
    const { A, id } = await setup(); const before = snap(A); const c0 = bal(A); const sm = id('smelter');
    const st = w.store as PgMineStore; const save = vi.spyOn(st, 'save').mockRejectedValue(new Error('boom'));
    vi.spyOn(st, 'txCommitted').mockResolvedValue(false);
    await expect(f.sell(A, { id: sm, kind: 'smelter', quote: 100 }, T0)).rejects.toThrow(/did not go through/);
    save.mockRestore(); vi.restoreAllMocks();
    expect(snap(A).ents).toEqual(before.ents); expect(bal(A)).toBe(c0); expect(await sales(A)).toHaveLength(0);
    expect(await f.sell(A, { id: sm, kind: 'smelter', quote: 100 }, T0 + 10)).toMatchObject({ paid: 100 }); // sellable again
    expect(await sales(A)).toHaveLength(1);
  });
  it('freezes production, views and the storage hook until the sale snapshot commits, then resumes', async () => {
    const { A, s, id } = await setup(); const sm = id('smelter');
    s.at = T0; s.seen = T0;
    const press = s.ents.find((e) => e.id === id('press'))!;
    press.r = 'p_iron_plate'; press.ib = { 'bar:iron_bar': 1 }; press.p = 0;
    const p = f.sell(A, { id: sm, kind: 'smelter', quote: 100 }, T0);
    // Even adjustStacks' synchronous beforeStorage hook must not move the clock/input buffer.
    expect(s.at).toBe(T0); expect(press.p).toBe(0);
    expect(f.get(A, T0 + 120_000)).toBe(s);
    expect(s.at).toBe(T0); expect(press.ib).toEqual({ 'bar:iron_bar': 1 });
    await p;
    const row = (await pool.query('SELECT data FROM factory_v2 WHERE player_key=$1', [A])).rows[0].data;
    expect(row.at).toBe(T0);
    expect(row.ents.find((e: { id: number }) => e.id === press.id).ib).toEqual({ 'bar:iron_bar': 1 });
    f.get(A, T0 + 120_000); expect(s.at).toBe(T0 + 120_000); // no lost catch-up, only delayed
  });
  it('lost commit ACK + initially unknown ledger outcome: credit once, retain lock, reconcile and survive restart', async () => {
    const { A, id } = await setup(); const sm = id('smelter'); const c0 = bal(A);
    const st = w.store as PgMineStore; const save = st.save.bind(st); const marker = st.txCommitted.bind(st);
    vi.spyOn(st, 'save').mockImplementation(async (...args) => { await save(...args); throw new Error('lost ACK'); });
    let checked = 0;
    vi.spyOn(st, 'txCommitted').mockImplementation(async (key) => {
      if (++checked <= 3) { expect(() => f.expand(A, T0)).toThrow(/Finishing your machine sale/); throw new Error('temporarily cannot reconcile'); }
      return marker(key);
    });
    expect(await f.sell(A, { id: sm, kind: 'smelter', quote: 100 }, T0)).toMatchObject({ paid: 100 });
    vi.restoreAllMocks();
    expect(checked).toBeGreaterThanOrEqual(4); expect(bal(A)).toBe(c0 + 100);
    expect(await sales(A)).toHaveLength(1); expect(await dbChips(A)).toBe(c0 + 100);
    await boot(); expect(f.get(A, T0)!.ents.some((e) => e.id === sm)).toBe(false);
    expect(bal(A)).toBe(c0 + 100);
  }, 15_000);

  it('initially unknown non-commit restores exactly once, releases lock and remains sellable', async () => {
    const { A, id } = await setup(); const sm = id('smelter'); const c0 = bal(A);
    const st = w.store as PgMineStore;
    vi.spyOn(st, 'save').mockRejectedValue(new Error('did not commit'));
    let checked = 0;
    vi.spyOn(st, 'txCommitted').mockImplementation(async () => { if (++checked <= 3) throw new Error('offline'); return false; });
    await expect(f.sell(A, { id: sm, kind: 'smelter', quote: 100 }, T0)).rejects.toThrow(/still there and nothing was paid/);
    vi.restoreAllMocks(); expect(bal(A)).toBe(c0); expect(await sales(A)).toHaveLength(0);
    expect(f.sellQuote(A, sm, T0).pay).toBe(100);
    expect(await f.sell(A, { id: sm, kind: 'smelter', quote: 100 }, T0 + 1)).toMatchObject({ paid: 100 });
    expect(await sales(A)).toHaveLength(1);
  }, 15_000);
  it('pickup/reinstall, sale, restart and expansion never regenerate the free starter machine', async () => {
    const { A, id } = await setup(); const sm = id('smelter');
    f.remove(A, [sm], T0); expect(f.get(A, T0)!.kit.smelter).toBe(1);
    f.place(A, [{ k: 'smelter', x: 2, y: 0, d: 0 }], T0);
    const reinstalled = f.get(A, T0)!.ents.find((e) => e.k === 'smelter')!;
    expect(reinstalled.id).not.toBe(sm);
    await f.sell(A, { id: reinstalled.id, kind: 'smelter', quote: 100 }, T0);
    await boot(); expect(f.get(A, T0)!.kit.smelter ?? 0).toBe(0);
    f.expand(A, T0); expect(f.get(A, T0)!.kit.smelter ?? 0).toBe(0);
    expect(() => f.place(A, [{ k: 'smelter', x: 2, y: 0, d: 0 }], T0)).toThrow(/Buy a Smelter/);
    expect(await sales(A)).toHaveLength(1);
  });

});
