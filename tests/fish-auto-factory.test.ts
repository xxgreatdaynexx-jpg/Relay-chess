import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Fishing, fishImportQty } from '../server/fishing';
import { writeImport } from '../server/factory';
import type { ImportSink } from '../server/farm';
import { COOLER_MAX } from '../shared/fishing';
import { MAX_BANKED_STACK } from '../shared/mines';

const T0 = Date.parse('2026-11-17T16:00:00Z'); // mid-day, hub awake

async function db() {
  const d = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(d); const { Pool } = d.adapters.createPg(); const pool = new Pool();
  await pool.query('CREATE TABLE IF NOT EXISTS mine_items (player_key TEXT NOT NULL, owner_name TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (player_key, item_type, item_id))');
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  const after: Array<Array<[string, number]>> = [];
  const stock: Record<string, number> = {};
  const sink = (name: string): ImportSink => ({
    write: async (cl, items) => { await writeImport(cl, name, items); },
    after: (items) => { after.push(items); for (const [id, n] of items) stock[id] = (stock[id] ?? 0) + n; },
  });
  const room = (headroom: Record<string, number> = {}) => (id: string) => {
    const cap = headroom[id] ?? MAX_BANKED_STACK;
    return Math.max(0, cap - (stock[id] ?? 0));
  };
  const hook = (name: string, headroom?: Record<string, number>) => ({ sink: sink(name), room: room(headroom) });
  const qty = (id: string) => Number(d.public.many(`SELECT qty FROM mine_items WHERE item_id = '${id}'`)[0]?.qty ?? 0);
  const unsold = async (fpool = pool) => (await fpool.query("SELECT id, species, loc FROM fish_catches WHERE sold_at IS NULL ORDER BY id")).rows as Array<{ id: string; species: string; loc: string | null }>;
  return { d, pool, bank, sink, room, hook, qty, stock, after, unsold };
}

describe('cooler capacity', () => {
  it('holds 2,000 unique catches, up from 40', () => {
    expect(COOLER_MAX).toBe(2_000);
  });
  it('accepts more than the old 40-fish cap and still refuses a cast when full', async () => {
    const { pool, bank } = await db();
    const f = new Fishing(pool, () => bank, () => T0); await f.init();
    for (let i = 0; i < 41; i++) {
      await pool.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [`c${i}`, 'pat', 'Pat', 'bass', 500, 18, T0, 'warehouse']);
    }
    const v = await f.view('Pat');
    expect(v.cooler.length).toBe(41);
    expect(v.cooler.length).toBeLessThan(COOLER_MAX);
    await expect(f.cast('Pat')).resolves.toMatchObject({ biteIn: expect.any(Number) });

    const values = Array.from({ length: COOLER_MAX }, (_, i) => `('full${i}','maxed','Maxed','bass',500,18,1,'warehouse')`).join(',');
    await pool.query(`INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, loc) VALUES ${values}`);
    await expect(f.cast('Maxed')).rejects.toThrow(/full \(2000\)/);
  });
});

describe('auto-process cooler fish to the factory', () => {
  it('defaults off and can be toggled per player', async () => {
    const { pool, bank } = await db();
    const f = new Fishing(pool, () => bank, () => T0); await f.init();
    expect((await f.view('Gus')).autoProcess).toBe(false);
    expect(await f.setAutoProcess('Gus', true)).toEqual({ autoProcess: true });
    expect((await f.view('Gus')).autoProcess).toBe(true);
    expect(await f.setAutoProcess('Gus', false)).toEqual({ autoProcess: false });
    expect((await f.view('Gus')).autoProcess).toBe(false);
    expect(await f.setAutoProcess('Gus', 'yes')).toEqual({ autoProcess: false }); // only boolean true opts in
  });

  it('moves city cooler fish into factory goods on the sweep, same rates as manual Bring-in, and does nothing when the toggle is off', async () => {
    const s = await db();
    const f = new Fishing(s.pool, () => s.bank, () => T0); await f.init();
    const ins = (id: string, sp: string, v: number, loc = 'warehouse', dish: string | null = null) =>
      s.pool.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, dish, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, 'gus', 'Gus', sp, 1000, v, T0, dish, loc]);
    await ins('a', 'bass', 24);
    await ins('b', 'salmon', 60, 'warehouse', 'Seared Salmon');
    await ins('c', 'boot', 2);
    await ins('d', 'trout', 20, 'resort'); // resort — must be shipped first
    await s.pool.query('INSERT INTO kitchen_dishes (id, player_key, name, recipe, quality, value, cooked_at, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', ['k1', 'gus', 'Gus', 'fried_fish', 0.9, 20, T0, 'warehouse']);

    expect(await f.autoSweep((name) => s.hook(name))).toBe(0); // toggle off
    expect(s.qty('fish_fillet') || 0).toBe(0);
    expect((await s.unsold()).map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'd']);

    await f.setAutoProcess('Gus', true);
    expect(await f.autoSweep((name) => s.hook(name))).toBe(1);
    expect(s.qty('fish_fillet')).toBe(fishImportQty(24, false)); // bass only
    expect(s.qty('fish_portion')).toBe(fishImportQty(60, true)); // pan-fried cooler salmon
    const left = await s.unsold();
    expect(left.map((r) => r.id).sort()).toEqual(['d']); // resort stays; city junk is auto-sold (tests/fish-auto-sell-small)
    expect((await s.pool.query('SELECT sold_at FROM kitchen_dishes WHERE id = $1', ['k1'])).rows[0].sold_at).toBeNull(); // fridge dishes are manual only
    // Second pass creates nothing extra.
    expect(await f.autoSweep((name) => s.hook(name))).toBe(0);
    expect(s.qty('fish_fillet')).toBe(3);
    expect(s.qty('fish_portion')).toBe(6);
  });

  it('moves only what fits in factory storage and leaves the rest in the cooler', async () => {
    const s = await db();
    const f = new Fishing(s.pool, () => s.bank, () => T0); await f.init();
    await f.setAutoProcess('Pat', true);
    const ins = (id: string, v: number, at: number) =>
      s.pool.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, 'pat', 'Pat', 'bass', 500, v, at, 'warehouse']);
    await ins('a', 24, 1); // 3 fillets
    await ins('b', 24, 2); // 3 fillets — does not fit after a
    await ins('c', 16, 3); // 2 fillets — fits beside a
    const n = await f.autoSweep((name) => s.hook(name, { fish_fillet: 5 }));
    expect(n).toBe(1);
    expect(s.qty('fish_fillet')).toBe(5);
    expect((await s.unsold()).map((r) => r.id)).toEqual(['b']);
    // Still opted in, but nothing else fits — no throw, no extra items.
    expect(await f.autoSweep((name) => s.hook(name, { fish_fillet: 5 }))).toBe(0);
    expect(s.qty('fish_fillet')).toBe(5);
    expect((await s.unsold()).map((r) => r.id)).toEqual(['b']);
  });

  it('does not sell fish or touch the daily payout tier', async () => {
    const s = await db();
    const f = new Fishing(s.pool, () => s.bank, () => T0); await f.init();
    await f.setAutoProcess('Ann', true);
    s.bank.transfer('Ann', 10_000, { game: 'admin' }); await s.bank.flush();
    const chips = s.bank.account('Ann').chips;
    await s.pool.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', ['x', 'ann', 'Ann', 'bass', 500, 24, T0, 'warehouse']);
    await f.autoSweep((name) => s.hook(name));
    expect(s.bank.account('Ann').chips).toBe(chips);
    const v = await f.view('Ann');
    expect(v.today.gross).toBe(0);
    expect(v.today.paid).toBe(0);
    expect(s.qty('fish_fillet')).toBe(3);
  });
});
