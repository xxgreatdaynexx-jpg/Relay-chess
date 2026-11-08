import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Mayor } from '../server/mayor';
import { City, setCityForTest, CITY_MIGRATION } from '../server/city';
import { setCityRates, citySurchargePctPer1k, cityDailyWealthTaxRate, cityWealthTaxRate, type CityRates } from '../server/city-rates';
import { RealEstate } from '../server/realEstate';
import { LEVERS, clampLever, leverText } from '../shared/city';
import { landPrice, landSurchargePct, landMultiplierNote, properties, SURCHARGE_PCT_PER_1K } from '../shared/realEstate';
import { planWealthTax, taxFor, WEALTH_TAX_RATE } from '../shared/wealthTax';
import { DAY_MS, WEEK_MS } from '../shared/mayor';
import { registerPgAdvisoryFunctions } from './pg-advisory';

const MON = Date.parse('2026-11-02T06:00:00Z'); const H = 3_600_000;
async function withMayor() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  await pool.query('CREATE TABLE players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
  let now = MON + 10 * H; const clock = () => now;
  const m = new Mayor(pool, () => bank, clock); await m.init();
  const c = new City(pool as never, () => m, clock, () => bank, () => 1); await c.init();
  for (const name of ['Ann', 'Bob', 'Cat']) { await pool.query('INSERT INTO players VALUES ($1,$2,$3)', [name.toLowerCase(), name, new Date(now - 3 * DAY_MS).toISOString()]); bank.transfer(name, 50_000, { game: 'admin' }); for (let i = 0; i < 6; i++) bank.transfer(name, 1, { game: 'slots' }); await bank.flush(); }
  await m.file('Ann', 'Build it'); await m.file('Cat', 'Runner up'); now = MON + 5 * DAY_MS; await m.vote('Bob', 'Ann'); now = MON + WEEK_MS + 9 * H;
  return { pool, c, m, bank, clock, set: (t: number) => { now = t; }, get now() { return now; } };
}
const fake = (v: Partial<Record<string, number>>): CityRates => ({ lever: (id) => v[id] ?? LEVERS[id].base, policyMul: () => 1, perk: () => 0 });

describe('pt2020u: property surcharge + daily wealth tax city levers', () => {
  it('defaults are exactly the live rules (nothing changes until a mayor acts)', () => {
    expect(LEVERS.property_surcharge.base * 100).toBe(SURCHARGE_PCT_PER_1K);
    expect(LEVERS.daily_wealth_tax.base).toBe(WEALTH_TAX_RATE);
    setCityRates(null); expect(citySurchargePctPer1k()).toBe(1); expect(cityDailyWealthTaxRate()).toBe(0.01);
    setCityRates(fake({})); expect(citySurchargePctPer1k()).toBe(1); expect(cityDailyWealthTaxRate()).toBe(0.01); expect(cityWealthTaxRate()).toBe(0.05);
    setCityRates(null);
    for (const v of [0, 999, 5000, 136_000, 1_234_567]) for (const l of [1000, 7_250, 250_000]) {
      expect(landPrice(l, v, citySurchargePctPer1k())).toBe(landPrice(l, v));
      expect(landMultiplierNote(v, 1)).toBe(landMultiplierNote(v));
    }
    const rows = [{ name: 'a', netWorth: 10_000, chips: 10_000 }, { name: 'b', netWorth: 20_000, chips: 5_000 }, { name: 'c', netWorth: 900_000, chips: 400_000 }, { name: 'd', netWorth: 6_000, chips: 6_000 }];
    expect(planWealthTax(rows, () => false, LEVERS.daily_wealth_tax.base)).toEqual(planWealthTax(rows));
  });
  it('bounds/snap: invalid -> default, out of range clamped, never negative or extreme', () => {
    for (const bad of [NaN, Infinity, -Infinity, 'x', null, undefined, '']) { expect(clampLever('property_surcharge', bad)).toBe(0.01); expect(clampLever('daily_wealth_tax', bad)).toBe(0.01); }
    expect(clampLever('property_surcharge', -1)).toBe(0.005); expect(clampLever('property_surcharge', 5)).toBe(0.02); expect(clampLever('property_surcharge', 0.0137)).toBe(0.0125);
    expect(clampLever('daily_wealth_tax', -0.5)).toBe(0.005); expect(clampLever('daily_wealth_tax', 1)).toBe(0.015);
    expect(leverText('property_surcharge', 0.0125)).toBe('1.25%'); expect(leverText('daily_wealth_tax', 0.0075)).toBe('0.75%');
    // the shared maths refuses rogue values too (falls back to the built-in rate)
    expect(landSurchargePct(10_000, -3)).toBe(10); expect(landSurchargePct(10_000, NaN)).toBe(10);
    expect(taxFor({ name: 'x', netWorth: 200_000, chips: 1e9 }, 100_000, 0.5)).toBe(1000); expect(taxFor({ name: 'x', netWorth: 200_000, chips: 1e9 }, 100_000, -1)).toBe(1000);
  });
  it('mayor-only, NaN rejected, cooldown, audited, persisted across restart, hot readers follow', async () => {
    const s = await withMayor(); setCityForTest(s.c);
    try {
      await expect(s.c.setLever('Bob', 'property_surcharge', 0.02)).rejects.toThrow(/sitting mayor/);
      await expect(s.c.setLever('Ann', 'daily_wealth_tax', NaN)).rejects.toThrow(/Pick a value/);
      await expect(s.c.setLever('Ann', 'property_surcharge', 0.01)).rejects.toThrow(/already the current value/);
      expect(citySurchargePctPer1k()).toBe(1); expect(cityDailyWealthTaxRate()).toBe(0.01);
      await s.c.setLever('Ann', 'property_surcharge', 0.015); await s.c.setLever('Ann', 'daily_wealth_tax', 99);
      expect(citySurchargePctPer1k()).toBe(1.5); expect(cityDailyWealthTaxRate()).toBe(0.015);
      await expect(s.c.setLever('Ann', 'property_surcharge', 0.005)).rejects.toThrow(/can change again/);
      const v = await s.c.view(null); const t = v.actions.filter((a) => a.kind === 'lever').map((a) => a.text);
      expect(t).toEqual(expect.arrayContaining(['Property surcharge (per 1,000 owned): 1% → 1.5%', 'Daily wealth tax: 1% → 1.5%']));
      expect(v.levers.property_surcharge.value).toBe(0.015);
      const c2 = new City(s.pool as never, () => s.m, s.clock); await c2.init(); // restart: same values, no duplicate rows
      expect(c2.lever('property_surcharge')).toBe(0.015); expect(c2.lever('daily_wealth_tax')).toBe(0.015);
      expect(Number((await s.pool.query("SELECT COUNT(*) AS n FROM city_levers WHERE lever IN ('property_surcharge','daily_wealth_tax')")).rows[0].n)).toBe(2);
    } finally { setCityForTest(null); }
  });
  it('real estate quote and purchase charge the lever surcharge; a stale max is refused (no bypass)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    const re = new RealEstate(pool, () => bank, () => Date.parse('2026-11-08T12:00:00Z')); await re.init();
    await pool.query(`CREATE TABLE farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
    CREATE TABLE farm_upgrades (plot_id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (plot_id, kind));
    CREATE TABLE farm_fert (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (plot_id, tile, nonce));`);
    await pool.query(CITY_MIGRATION); // the fake City Hall is live, so the 25% treasury share (pt2032u) needs its tables
    bank.transfer('Ivy', 500_000, { game: 'admin' }); await bank.flush();
    const [a, b] = [...properties()].filter((p) => p.kind !== 'landmark' && p.price < 20_000).sort((x, y) => x.price - y.price);
    try {
      setCityRates(fake({}));
      const first = await re.buy('Ivy', a!.id); const owned = first.price;
      const q0 = await re.quote('Ivy', b!.id); expect(q0.surchargePer1k).toBe(1); expect(q0.price).toBe(landPrice(b!.price, owned));
      setCityRates(fake({ property_surcharge: 0.02 }));
      const q = await re.quote('Ivy', b!.id); expect(q.surchargePer1k).toBe(2); expect(q.price).toBe(landPrice(b!.price, owned, 2)); expect(q.price).toBeGreaterThan(q0.price);
      await expect(re.buy('Ivy', b!.id, q0.price)).rejects.toThrow(/price changed/); // quoted at the old rate: refused, nothing charged
      const r = await re.buy('Ivy', b!.id, q.price); expect(r.price).toBe(q.price);
    } finally { setCityRates(null); }
  });
});
