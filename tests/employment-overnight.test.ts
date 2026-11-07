import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Employment, type OreSink } from '../server/employment';
import { FISH_MIGRATION } from '../server/fishing';
import { setPriceIndexForTest } from '../server/price-index';
import { DAY, HOUR } from '../shared/employment';

const L = (s: string) => Date.parse(`${s}-06:00`);
async function setup(t0: number) {
  setPriceIndexForTest(1);
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  await pool.query('CREATE TABLE players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
  await pool.query(FISH_MIGRATION);
  let now = t0; const stored = new Map<string, number>();
  const sink = (): OreSink => ({ async write(_cl, items) { for (const [id, n] of items) stored.set(id, (stored.get(id) ?? 0) + n); }, after() {} });
  let s = 7; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const mk = () => new Employment(pool, () => bank, () => now, sink, rnd);
  const e = mk(); await e.init();
  await pool.query('INSERT INTO players VALUES ($1,$1,$2)', ['gus', new Date(t0 - 2 * DAY).toISOString()]);
  bank.transfer('Gus', 1_000_000, { game: 'admin' }); await bank.flush();
  const total = () => [...stored.values()].reduce((a, b) => a + b, 0);
  return { e, mk, total, setNow: (t: number) => { now = t; } };
}

describe('workers keep producing through the 01–07 lockout (t1899u)', () => {
  it('last visit 23:00: production runs to 13:00 (8 awake h + the real 6 h closure), not 07:00; no 7h grant', async () => {
    const s = await setup(L('2026-11-06T23:00:00')); await s.e.hire('Gus', 'miner:mine');
    s.setNow(L('2026-11-07T07:00:00')); await s.e.sweep(); expect(s.total()).toBe(240); // 8 h × 30/h (miners every 2 min, pt1966u), nothing frozen during closure
    s.setNow(L('2026-11-07T20:00:00')); await s.e.sweep(); expect(s.total()).toBe(420); // stops at 13:00 = 14 h × 30
    // restart + repeated sweeps never double-pay
    const e2 = s.mk(); await e2.init(); await e2.sweep(); await e2.sweep(); await Promise.all([e2.sweep(), s.e.sweep()]);
    expect(s.total()).toBe(420);
  });
  it('awake-only absence keeps the original 8h cap', async () => {
    const s = await setup(L('2026-11-06T08:00:00')); await s.e.hire('Gus', 'miner:mine');
    s.setNow(L('2026-11-06T23:00:00')); await s.e.sweep(); expect(s.total()).toBe(240);
    expect(8 * HOUR).toBe(28_800_000);
  });
});
