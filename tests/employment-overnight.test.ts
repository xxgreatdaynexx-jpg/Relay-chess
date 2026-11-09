import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Employment, type OreSink } from '../server/employment';
import { FISH_MIGRATION } from '../server/fishing';
import { setPriceIndexForTest } from '../server/price-index';
import { DAY, HOUR, MIN } from '../shared/employment';
import { isHubAwake } from '../shared/hubSleep';

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

describe('workers keep producing through the 01–07 hub closure (pt2097u)', () => {
  it('wall-clock production continues across overnight sleep (no freeze, no 8 h away-cap)', async () => {
    // 23:00 local → through 01–07 sleep → 08:00 = 9 wall hours × 30 picks/h = 270
    const t0 = L('2026-11-06T23:00:00');
    expect(isHubAwake(t0)).toBe(true);
    expect(isHubAwake(L('2026-11-07T03:00:00'))).toBe(false);
    const s = await setup(t0); await s.e.hire('Gus', 'miner:mine');
    s.setNow(L('2026-11-07T08:00:00')); await s.e.sweep();
    expect(s.total()).toBe(270); // 9 h × 30/h, including the 6 h sleep
    expect((await s.e.view('Gus')).workers[0]!.status).toBe('working');
    // restart + repeated sweeps never double-pay
    const e2 = s.mk(); await e2.init(); await e2.sweep(); await e2.sweep(); await Promise.all([e2.sweep(), s.e.sweep()]);
    expect(s.total()).toBe(270);
  });
  it('catch-up after a long server downtime is bounded per settle but keeps going on later sweeps', async () => {
    const t0 = L('2026-11-06T08:00:00');
    const s = await setup(t0); await s.e.hire('Gus', 'miner:mine');
    // Jump 5 days (simulates deploy/downtime); one settle pass renews at most 4 paid days
    s.setNow(t0 + 5 * DAY); await s.e.sweep();
    const afterOne = s.total();
    expect(afterOne).toBeGreaterThan(0);
    expect(afterOne).toBeLessThanOrEqual(4 * 720 + 60); // ≤4 full days of miner picks (+slack)
    await s.e.sweep(); await s.e.sweep();
    expect(s.total()).toBeGreaterThanOrEqual(afterOne);
    expect((await s.e.view('Gus')).workers[0]!.status).toBe('working');
  });
});
