import { afterEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore, resetBank } from '../server/casino-store';
import { Fishing, fishImportQty } from '../server/fishing';
import { writeImport } from '../server/factory';
import type { ImportSink } from '../server/farm';
import { setPriceIndexForTest, priceIndex } from '../server/price-index';
import { setHouseCapIndexForTest, houseCapIndexOrFloor, HOUSE_CAP_FLOOR } from '../server/house-cap-index';
import { fishDailyKey, fishPayout, fishSellValue, fishSpotCap } from '../shared/fishing';
import { MAX_BANKED_STACK } from '../shared/mines';

const T0 = Date.parse('2026-11-18T16:00:00Z');

async function setup() {
  const d = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(d); const { Pool } = d.adapters.createPg(); const pool = new Pool();
  await pool.query('CREATE TABLE IF NOT EXISTS mine_items (player_key TEXT NOT NULL, owner_name TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (player_key, item_type, item_id))');
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  const stock: Record<string, number> = {};
  const sink = (name: string): ImportSink => ({
    write: async (cl, items) => { await writeImport(cl, name, items); },
    after: (items) => { for (const [id, n] of items) stock[id] = (stock[id] ?? 0) + n; },
  });
  const hook = (name: string, headroom: Record<string, number> = {}) => ({ sink: sink(name), room: (id: string) => Math.max(0, (headroom[id] ?? MAX_BANKED_STACK) - (stock[id] ?? 0)) });
  const f = new Fishing(pool, () => bank, () => T0); await f.init();
  const put = (id: string, species: string, value: number, loc = 'warehouse', dish: string | null = null) =>
    pool.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, dish, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, 'gus', 'Gus', species, 300, value, T0, dish, loc]);
  const unsold = async () => ((await pool.query('SELECT id FROM fish_catches WHERE sold_at IS NULL ORDER BY id')).rows as Array<{ id: string }>).map((r) => r.id);
  const all = async () => ((await pool.query('SELECT id FROM fish_catches ORDER BY id')).rows as Array<{ id: string }>).map((r) => r.id);
  return { pool, bank, f, put, hook, stock, unsold, all };
}

describe('cooler auto-process sells fish too small to fillet', () => {
  afterEach(() => { setPriceIndexForTest(1); setHouseCapIndexForTest(HOUSE_CAP_FLOOR); resetBank(); });

  it('sells small city fish and junk through the normal sell prices and daily cap, and processes the rest', async () => {
    setPriceIndexForTest(1.25);
    const s = await setup();
    await s.f.setAutoProcess('Gus', true);
    await s.put('big', 'bass', 24);       // 3 fillets
    await s.put('tiny1', 'bass', 5);      // 0 fillets
    await s.put('tiny2', 'perch', 7);     // 0 fillets
    await s.put('boot', 'boot', 2);       // junk
    expect(fishImportQty(5, false)).toBe(0); expect(fishImportQty(7, false)).toBe(0);
    const before = s.bank.account('Gus').chips;
    expect(await s.f.autoSweep((n) => s.hook(n))).toBe(1);
    await s.bank.flush();
    expect(s.stock.fish_fillet).toBe(3);
    expect(await s.unsold()).toEqual([]);
    const gross = Math.floor(fishSellValue(5 + 7 + 2));
    const paid = Math.floor(fishPayout(gross, 0, 'lake', houseCapIndexOrFloor()) * priceIndex());
    expect(paid).toBeGreaterThan(0);
    expect(s.bank.account('Gus').chips).toBe(before + paid);
    const v = await s.f.view('Gus');
    expect(v.today.gross).toBe(gross); // counts toward the normal lake cap
    expect(v.today.paid).toBe(paid);
    const memo = (await s.pool.query("SELECT memo FROM wallet_transactions WHERE game = 'fish_sell'")).rows as Array<{ memo: string }>;
    expect(memo.length).toBe(1);
    expect(memo[0]!.memo).toMatch(/^Cooler auto-sell \(too small to fillet\): sold /);
  });

  it('does nothing when auto-process is off', async () => {
    const s = await setup();
    await s.put('tiny', 'bass', 5); await s.put('boot', 'boot', 2);
    const before = s.bank.account('Gus').chips;
    expect(await s.f.autoSweep((n) => s.hook(n))).toBe(0);
    expect(await s.unsold()).toEqual(['boot', 'tiny']);
    expect(s.bank.account('Gus').chips).toBe(before);
  });

  it('leaves small fish in the cooler (not deleted) once the daily cap is used up', async () => {
    const s = await setup();
    await s.f.setAutoProcess('Gus', true);
    await s.pool.query('INSERT INTO fish_daily (player_key, day, gross, paid) VALUES ($1,$2,$3,$3)', [fishDailyKey('gus', 'lake'), '2026-11-18', fishSpotCap('lake', houseCapIndexOrFloor())]);
    await s.put('tiny', 'bass', 5);
    const before = s.bank.account('Gus').chips;
    expect(await s.f.autoSweep((n) => s.hook(n))).toBe(0);
    expect(await s.unsold()).toEqual(['tiny']);
    expect(await s.all()).toEqual(['tiny']);
    expect(s.bank.account('Gus').chips).toBe(before);
  });

  it('does not sell fish that are only waiting on factory storage room, or resort / factory-map fish', async () => {
    const s = await setup();
    await s.f.setAutoProcess('Gus', true);
    await s.put('big', 'bass', 24);                 // fillet-able, but storage is full
    await s.put('rtiny', 'trout', 5, 'resort');     // resort: ship to the city first
    const before = s.bank.account('Gus').chips;
    expect(await s.f.autoSweep((n) => s.hook(n, { fish_fillet: 0 }))).toBe(0);
    expect(await s.unsold()).toEqual(['big', 'rtiny']);
    expect(s.bank.account('Gus').chips).toBe(before);
  });

  it('sells a pan-fried cooler dish too small for a portion through the cooking cap', async () => {
    const s = await setup();
    await s.f.setAutoProcess('Gus', true);
    await s.put('dish', 'bass', 9, 'warehouse', 'Pan-Fried Bass'); // 0 portions at 1 per 10
    expect(fishImportQty(9, true)).toBe(0);
    await s.f.autoSweep((n) => s.hook(n));
    expect(await s.unsold()).toEqual([]);
    expect(s.stock.fish_portion ?? 0).toBe(0);
  });
});
