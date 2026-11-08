import { afterAll, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import pg from 'pg';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Mayor } from '../server/mayor';
import { City, setCityForTest, cityPerk } from '../server/city';
import { PROJECTS, PROJECT_IDS, combinedPerk, projectCap, BUILDINGS, POLICIES } from '../shared/city';
import { DAY_MS, WEEK_MS } from '../shared/mayor';

const MON = Date.parse('2026-11-02T06:00:00Z'); const H = 3_600_000;
async function setup(pool: any, bankPool = pool) {
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(bankPool));
  await pool.query('CREATE TABLE IF NOT EXISTS players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
  let now = MON + 10 * H; const clock = () => now;
  const m = new Mayor(pool, () => bank, clock); await m.init();
  const c = new City(pool as never, () => m, clock, () => bank, () => 1); await c.init();
  for (const name of ['Ann', 'Bob', 'Cat']) { await pool.query('INSERT INTO players VALUES ($1,$2,$3)', [name.toLowerCase(), name, new Date(now - 3 * DAY_MS).toISOString()]); bank.transfer(name, 50_000, { game: 'admin' }); for (let i = 0; i < 6; i++) bank.transfer(name, 1, { game: 'slots' }); await bank.flush(); }
  await m.file('Ann', 'Build it'); await m.file('Cat', 'Runner up'); now = MON + 5 * DAY_MS; await m.vote('Bob', 'Ann'); now = MON + WEEK_MS + 9 * H;
  const fund = (n: number) => pool.query("UPDATE city_treasury SET balance = $1 WHERE id = 'main'", [n]);
  const bal = async () => Number((await pool.query("SELECT balance FROM city_treasury WHERE id='main'")).rows[0].balance);
  const chips = (n: string) => bank.account(n).chips;
  return { pool, bank, m, c, clock, fund, bal, chips, set: (t: number) => { now = t; }, get now() { return now; } };
}
const memPool = () => { const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); return new Pool(); };

describe('treasury projects: rules', () => {
  it('economics as chosen; caps never exceed the fully built building; non-stacking', () => {
    expect(PROJECT_IDS).toEqual(['road_repair', 'community_festival']);
    expect(PROJECTS.road_repair).toMatchObject({ perk: 'truck_speed', boost: 0.1, cost: 120_000, durationMs: 72 * H, cooldownMs: 72 * H });
    expect(PROJECTS.community_festival).toMatchObject({ perk: 'xp', boost: 0.05, cost: 75_000, durationMs: 48 * H, cooldownMs: 72 * H });
    expect(projectCap('road_repair')).toBe(BUILDINGS.highway.perkBy[2]); expect(projectCap('community_festival')).toBe(BUILDINGS.park.perkBy[2]);
    const run = (s: number, e: number) => ({ id: 'x', project: 'road_repair' as const, startsAt: s, endsAt: e, cost: 1, by: 'A' });
    expect(combinedPerk('truck_speed', 0, [], 5)).toBe(0);
    expect(combinedPerk('truck_speed', 0.2, [run(0, 10)], 5)).toBeCloseTo(0.3);
    expect(combinedPerk('truck_speed', 0.3, [run(0, 10)], 5)).toBe(0.3); // capped
    expect(combinedPerk('truck_speed', 0.1, [run(0, 10), run(0, 10)], 5)).toBeCloseTo(0.2); // no stacking
    expect(combinedPerk('truck_speed', 0.1, [run(0, 10)], 10)).toBe(0.1); // expired at end
    expect(combinedPerk('xp', 0, [run(0, 10)], 5)).toBe(0); // other perk untouched
    expect(POLICIES.farm_subsidy.cost).toBe(50_000); // existing spends unchanged
  });
});

describe('treasury projects: City (pg-mem)', () => {
  it('nothing active by default; mayor-only; atomic debit + ledger + public log; perk applies; cooldown; replay-safe', async () => {
    const s = await setup(memPool()); setCityForTest(s.c);
    try {
      const v0 = await s.c.view(null); expect(v0.projects!.every((p) => !p.active)).toBe(true); expect(v0.projectLog).toEqual([]); expect(cityPerk('truck_speed')).toBe(0);
      await s.fund(1_000_000); const chipsBefore = ['Ann', 'Bob', 'Cat'].map(s.chips);
      await expect(s.c.startProject('Bob', 'road_repair')).rejects.toThrow(/sitting mayor/);
      await expect(s.c.startProject('Ann', 'nope')).rejects.toThrow(/Unknown project/);
      await expect(s.c.startProject('Ann', 'road_repair', 'bad id!')).rejects.toThrow(/Bad request id/);
      expect(await s.bal()).toBe(1_000_000);
      const r = await s.c.startProject('Ann', 'road_repair', 'req-0001-abcd'); expect(r.cost).toBe(120_000);
      expect(await s.bal()).toBe(880_000); expect(cityPerk('truck_speed')).toBeCloseTo(0.1);
      const again = await s.c.startProject('Ann', 'road_repair', 'req-0001-abcd'); expect(again.replay).toBe(true); expect(await s.bal()).toBe(880_000);
      await expect(s.c.startProject('Bob', 'road_repair', 'req-0001-abcd')).rejects.toThrow(/already used/);
      await expect(s.c.startProject('Ann', 'road_repair')).rejects.toThrow(/already running/);
      const v = await s.c.view(null);
      expect(v.treasury.ledger[0]).toMatchObject({ kind: 'project', amount: -120_000 }); expect(v.treasury.ledger[0]!.memo).toMatch(/Road repairs by Mayor Ann: .* → /);
      expect(v.actions.find((a) => a.kind === 'project')!.text).toMatch(/\+10% truck speed for everyone/);
      expect(v.projectLog![0]).toMatchObject({ project: 'road_repair', by: 'Ann', cost: 120_000 });
      expect(['Ann', 'Bob', 'Cat'].map(s.chips)).toEqual(chipsBefore); // no wallet ever paid
      s.set(s.now + 72 * H); expect(cityPerk('truck_speed')).toBe(0); // expired
      await expect(s.c.startProject('Ann', 'road_repair')).rejects.toThrow(/can run again/);
      // restart: same state from the DB
      const c2 = new City(s.pool as never, () => s.m, s.clock, () => s.bank, () => 1); await c2.init(); expect(c2.nextProjectAt('road_repair')).toBe(s.c.nextProjectAt('road_repair'));
    } finally { setCityForTest(null); }
  });
  it('insufficient funds and zero-headroom refuse with nothing debited', async () => {
    const s = await setup(memPool());
    await s.fund(10_000); await expect(s.c.startProject('Ann', 'community_festival')).rejects.toThrow(/doesn't have/); expect(await s.bal()).toBe(10_000);
    expect((await s.pool.query('SELECT count(*) AS n FROM city_projects')).rows[0].n).toBe(0);
    await s.pool.query("INSERT INTO city_buildings (id, stage) VALUES ('park', 3) ON CONFLICT (id) DO UPDATE SET stage = 3"); await s.c.reload(); await s.fund(1_000_000);
    await expect(s.c.startProject('Ann', 'community_festival')).rejects.toThrow(/would add nothing/); expect(await s.bal()).toBe(1_000_000);
  });
});

const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const drops: Array<() => Promise<void>> = []; afterAll(async () => { for (const d of drops) await d(); });
describe.skipIf(!url)('treasury projects: real PostgreSQL', () => {
  it('two server instances racing the same project debit exactly once', async () => {
    const u = new URL(url!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only');
    const name = `tp_${process.pid}_${Date.now()}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
    u.pathname = `/${name}`; const pool = new pg.Pool({ connectionString: u.toString(), max: 6 }); drops.push(async () => { await pool.end(); await root.query(`DROP DATABASE ${name}`); await root.end(); });
    const s = await setup(pool); await s.fund(500_000);
    const c2 = new City(pool as never, () => s.m, s.clock, () => s.bank, () => 1); await c2.init();
    const res = await Promise.allSettled([s.c.startProject('Ann', 'road_repair'), c2.startProject('Ann', 'road_repair'), s.c.startProject('Ann', 'road_repair')]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await s.bal()).toBe(380_000);
    expect(Number((await pool.query("SELECT count(*) AS n FROM city_treasury_ledger WHERE kind = 'project'")).rows[0].n)).toBe(1);
    // same request id retried on both instances concurrently: one debit
    const both = await Promise.allSettled([s.c.startProject('Ann', 'community_festival', 'retry-1234-x'), c2.startProject('Ann', 'community_festival', 'retry-1234-x')]);
    expect(both.every((r) => r.status === 'fulfilled')).toBe(true); expect(await s.bal()).toBe(305_000);
  });
});
