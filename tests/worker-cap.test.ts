import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Employment } from '../server/employment';
import { FISH_MIGRATION } from '../server/fishing';
import { PROPERTY_MIGRATION } from '../server/realEstate';
import { properties, workerBonusOf, workerBonusTotal, WORKER_BONUS_MAX } from '../shared/realEstate';
import { MAX_WORKERS, DAY } from '../shared/employment';

const T0 = Date.parse('2026-11-02T12:00:00Z');
async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  await pool.query('CREATE TABLE players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
  await pool.query(FISH_MIGRATION); await pool.query(PROPERTY_MIGRATION);
  const e = new Employment(pool, () => bank, () => T0); await e.init();
  await pool.query('INSERT INTO players VALUES ($1,$1,$2)', ['gus', new Date(T0 - 2 * DAY).toISOString()]);
  bank.transfer('Gus', 10_000_000 - bank.account('Gus').chips, { game: 'admin' }); await bank.flush();
  const own = (id: string) => pool.query('INSERT INTO properties (id, owner_key, owner_name, price, bought_at, deed) VALUES ($1,$2,$3,$4,$5,$6)', [id, 'gus', 'Gus', 1, T0, 1]);
  const drop = (id: string) => pool.query('DELETE FROM properties WHERE id = $1', [id]);
  return { e, own, drop };
}
const byType = (t: string) => properties().find((p) => p.type === t)!;

describe('worker cap from property', () => {
  it('bonus tiers by property type', () => {
    expect(workerBonusOf(byType('house').id)).toBe(1);
    expect(workerBonusOf(byType('apartment').id)).toBe(2);
    expect(workerBonusOf(byType('tower').id)).toBe(3);
    expect(workerBonusOf('lm:casino')).toBe(4);
    expect(workerBonusOf(byType('lot').id)).toBe(0);
    expect(workerBonusOf(byType('farmland').id)).toBe(0);
    expect(workerBonusOf('nope')).toBe(0);
    expect(workerBonusTotal(['lm:casino', 'lm:bank', 'lm:arena'])).toBe(WORKER_BONUS_MAX);
  });
  it('raises the cap, and losing property blocks hires without firing anyone', async () => {
    const s = await setup();
    expect((await s.e.view('Gus')).max).toBe(MAX_WORKERS);
    const h = byType('house').id; await s.own(h);
    const v = await s.e.view('Gus'); expect([v.max, v.base, v.bonus]).toEqual([MAX_WORKERS + 1, MAX_WORKERS, 1]);
    for (let i = 0; i < MAX_WORKERS + 1; i++) await s.e.hire('Gus', 'miner:mine');
    await expect(s.e.hire('Gus', 'miner:mine')).rejects.toThrow(/at most 4/);
    await s.drop(h);
    const after = await s.e.view('Gus');
    expect(after.workers).toHaveLength(MAX_WORKERS + 1); expect(after.canHire).toBe(false); expect(after.reason).toMatch(/keep working/);
    await expect(s.e.hire('Gus', 'miner:mine')).rejects.toThrow();
  });
});
