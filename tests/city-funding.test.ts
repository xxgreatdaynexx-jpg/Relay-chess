import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Mayor } from '../server/mayor';
import { City, setCityForTest } from '../server/city';
import {
  LEVERS, POLICIES, PROJECTS, BUILDINGS, fundingView, cityFundingScore, leverFunding, fundingCostMul, fundingBuildTimeMul, fundingBoostMul, fundingLabel, FUNDING_LEVER_IDS,
} from '../shared/city';
import { DAY_MS, WEEK_MS } from '../shared/mayor';
import { registerPgAdvisoryFunctions } from './pg-advisory';

const MON = Date.parse('2026-11-02T06:00:00Z'); const H = 3_600_000;
async function withMayor() {
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  await pool.query('CREATE TABLE players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
  let now = MON + 10 * H; const clock = () => now;
  const m = new Mayor(pool, () => bank, clock); await m.init();
  const c = new City(pool as never, () => m, clock, () => bank, () => 1); await c.init();
  for (const name of ['Ann', 'Bob', 'Cat']) {
    await pool.query('INSERT INTO players VALUES ($1,$2,$3)', [name.toLowerCase(), name, new Date(now - 3 * DAY_MS).toISOString()]);
    bank.transfer(name, 5_000_000, { game: 'admin' }); for (let i = 0; i < 6; i++) bank.transfer(name, 1, { game: 'slots' }); await bank.flush();
  }
  await m.file('Ann', 'Build it'); await m.file('Cat', 'Runner up'); now = MON + 5 * DAY_MS; await m.vote('Bob', 'Ann'); now = MON + WEEK_MS + 9 * H;
  // Seed treasury so policies/projects/builds can run
  await pool.query('UPDATE city_treasury SET balance = $1', [5_000_000]);
  return { pool, c, m, bank, set: (t: number) => { now = t; }, get now() { return now; } };
}

describe('city tax funding tradeoffs (pt2099u)', () => {
  it('defaults score 0 / Balanced; mins go negative; maxes positive; muls are gradual', () => {
    const base = Object.fromEntries(FUNDING_LEVER_IDS.map((id) => [id, LEVERS[id].base]));
    expect(cityFundingScore(base)).toBe(0);
    expect(fundingLabel(0)).toBe('Balanced');
    expect(fundingCostMul(0)).toBe(1); expect(fundingBuildTimeMul(0)).toBe(1); expect(fundingBoostMul(0)).toBe(1);
    // freight & sales_tax cannot go below base → contrib 0 at min
    expect(leverFunding('freight', LEVERS.freight.min)).toBe(0);
    expect(leverFunding('sales_tax', 0)).toBe(0);
    expect(leverFunding('wealth_tax', LEVERS.wealth_tax.min)).toBe(-1);
    expect(leverFunding('daily_wealth_tax', LEVERS.daily_wealth_tax.min)).toBe(-1);
    expect(leverFunding('wealth_tax', LEVERS.wealth_tax.max)).toBe(1);
    const low = fundingView({ wealth_tax: 0.03, daily_wealth_tax: 0.005, sales_tax: 0, freight: 1 });
    expect(low.score).toBeLessThan(0); expect(low.costMul).toBeGreaterThan(1); expect(low.buildMul).toBeGreaterThan(1); expect(low.boostMul).toBeLessThan(1);
    const high = fundingView({ wealth_tax: 0.07, daily_wealth_tax: 0.015, sales_tax: 0.05, freight: 1.2 });
    expect(high.score).toBeGreaterThan(0); expect(high.costMul).toBeLessThan(1); expect(high.buildMul).toBeLessThan(1); expect(high.boostMul).toBeGreaterThan(1);
    // no cliffs: midpoints between base and min/max are partial
    expect(leverFunding('wealth_tax', 0.04)).toBeCloseTo(-0.5, 5);
    expect(leverFunding('wealth_tax', 0.06)).toBeCloseTo(0.5, 5);
  });

  it('view exposes funding; low taxes raise policy/project/build costs and stretch build time; high taxes do the reverse', async () => {
    const s = await withMayor(); setCityForTest(s.c);
    try {
      const v0 = await s.c.view(null);
      expect(v0.funding?.label).toBe('Balanced');
      expect(v0.funding?.costMul).toBe(1);
      const basePolicy = Math.round(POLICIES.farm_subsidy.cost);
      const baseProj = Math.round(PROJECTS.road_repair.cost);
      const baseBuild = Math.round(BUILDINGS.lights.stages[0]!);
      expect(v0.projects!.find((p) => p.id === 'road_repair')!.cost).toBe(baseProj);
      expect(v0.buildings.find((b) => b.id === 'lights')!.nextCost).toBe(baseBuild);

      // Push wealth taxes to minimum (sales/freight stay at floor)
      await s.c.setLever('Ann', 'wealth_tax', 0.03);
      s.set(s.now + 73 * H); // clear 72h cooldown
      await s.c.setLever('Ann', 'daily_wealth_tax', 0.005);
      const vLow = await s.c.view(null);
      expect(vLow.funding!.score).toBeLessThan(0);
      expect(vLow.funding!.costMul).toBeGreaterThan(1);
      expect(vLow.projects!.find((p) => p.id === 'road_repair')!.cost).toBe(Math.round(baseProj * vLow.funding!.costMul));
      expect(vLow.buildings.find((b) => b.id === 'lights')!.nextCost).toBe(Math.round(baseBuild * vLow.funding!.costMul));

      const before = Number((await s.pool.query('SELECT balance FROM city_treasury')).rows[0].balance);
      const pol = await s.c.startPolicy('Ann', 'farm_subsidy');
      expect(pol.cost).toBe(Math.round(basePolicy * vLow.funding!.costMul));
      expect(pol.cost).toBeGreaterThan(basePolicy);
      const afterPol = Number((await s.pool.query('SELECT balance FROM city_treasury')).rows[0].balance);
      expect(before - afterPol).toBe(pol.cost);

      // Build time stretched
      s.set(s.now + 25 * H); // policy cooldown not needed for build
      const b = await s.c.build('Ann', 'lights');
      expect(b.doneAt - s.now).toBe(Math.round(BUILDINGS.lights.buildMs[0]! * vLow.funding!.buildMul));
      expect(b.doneAt - s.now).toBeGreaterThan(BUILDINGS.lights.buildMs[0]!);
    } finally { setCityForTest(null); }
  });
});
