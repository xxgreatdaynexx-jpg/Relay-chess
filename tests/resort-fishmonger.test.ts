import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore, resetBank } from '../server/casino-store';
import { Fishing } from '../server/fishing';
import { Travel, setTravel, awayFromFishmonger, awayFromMarket, MARKET_AWAY_MSG } from '../server/travel';
import { setPriceIndexForTest, priceIndex } from '../server/price-index';
import { setHouseCapIndexForTest, houseCapIndexOrFloor, HOUSE_CAP_FLOOR } from '../server/house-cap-index';
import { FISH_SPOT_CAP, fishPayout, fishSellValue } from '../shared/fishing';
import { RESORT_SPOTS } from '../shared/resort';

const T0 = Date.parse('2026-11-17T12:00:00Z');
const N = 'Ann';

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const f = new Fishing(pool, () => bank, () => now); await f.init();
  const put = async (id: string, species: string, value: number, loc: string) => {
    await pool.query('INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, 'ann', N, species, 1000, value, now, loc]);
  };
  return { pool, bank, f, put, adv: (ms: number) => { now += ms; } };
}

describe('resort fishmonger', () => {
  afterEach(() => { setTravel(new Travel(null)); setPriceIndexForTest(1); setHouseCapIndexForTest(HOUSE_CAP_FLOOR); resetBank(); });

  it('the pier points players to the fishmonger at the tiki shack', () => {
    const p = RESORT_SPOTS.find((s) => s.id === 'r-pier')!;
    expect(p.blurb).toMatch(/fishmonger/i);
    expect(readFileSync('client/src/components/FishingPanel.tsx', 'utf8')).toMatch(/Sell all to the fishmonger/);
    expect(readFileSync('client/src/components/ResortMap.tsx', 'utf8')).toMatch(/spot="reef"/);
  });

  it('the sell socket allows the city and the resort, and still refuses Fort McChud, the island and a voyage', async () => {
    expect(readFileSync('server/fishing.ts', 'utf8')).toMatch(/on\('fish_sell', \(b, f, n\) => \{ awayFromFishmonger\(n, FishError\)/);
    const t = new Travel(null); setTravel(t); class E extends Error {}
    expect(() => awayFromFishmonger(N, E)).not.toThrow();
    await t.carry(N, 'resort'); expect(() => awayFromFishmonger(N, E)).not.toThrow();
    expect(() => awayFromMarket(N, E)).toThrow(MARKET_AWAY_MSG); // diner / city markets stay warehouse-only
    await t.carry(N, 'fortmc'); expect(() => awayFromFishmonger(N, E)).toThrow(MARKET_AWAY_MSG);
    await t.carry(N, 'island'); expect(() => awayFromFishmonger(N, E)).toThrow(MARKET_AWAY_MSG);
    await t.carry(N, 'voyage'); expect(() => awayFromFishmonger(N, E)).toThrow(MARKET_AWAY_MSG);
    await t.home(N); expect(() => awayFromFishmonger(N, E)).not.toThrow();
  });

  it('sells resort-cooler fish at the same indexed, cap-scaled prices as the city dock, without trucking them to the city warehouse', async () => {
    setPriceIndexForTest(1.37); setHouseCapIndexForTest(1.2);
    const { bank, f, put } = await setup();
    const t = new Travel(null); setTravel(t); await t.carry(N, 'resort');
    await put('r1', 'snapper', 80_000, 'resort');
    const gross = Math.floor(fishSellValue(80_000));
    const expectPaid = Math.floor(fishPayout(gross, 0, 'reef', houseCapIndexOrFloor()) * priceIndex());
    const before = bank.account(N).chips;
    const s = await f.sell(N); await bank.flush();
    expect(s.sold).toBe(1); expect(s.paid).toBe(expectPaid); expect(bank.account(N).chips).toBe(before + expectPaid);
    expect((await f.view(N)).cooler).toEqual([]);
    expect((await f.view(N)).todayBySpot!.reef.gross).toBeCloseTo(gross);
  });

  it('enforces the reef daily cap (scaled by the house-cap index) and does not pay a second time', async () => {
    setPriceIndexForTest(1); setHouseCapIndexForTest(2);
    const { bank, f, put } = await setup();
    const cap = FISH_SPOT_CAP.reef * 2; // floor 230k, index 2
    await put('r1', 'snapper', 400_000, 'resort'); // 400k × 1.15 = 460k gross, capped
    const before = bank.account(N).chips;
    const s1 = await f.sell(N); await bank.flush();
    expect(s1.sold).toBe(1); expect(s1.paid).toBe(fishPayout(Math.floor(fishSellValue(400_000)), 0, 'reef', 2));
    expect(s1.paid).toBe(cap); expect(bank.account(N).chips).toBe(before + s1.paid);
    await put('r2', 'snapper', 50_000, 'resort');
    await expect(f.sell(N)).rejects.toThrow(/bought all/);
    expect((await f.view(N)).cooler.map((c) => c.id)).toEqual(['r2']);
    expect(bank.account(N).chips).toBe(before + s1.paid); // no second payout
  });

  it('does not invent a second payout path: a fish already sold stays sold, and factory-bin fish still cannot be sold until moved to a warehouse', async () => {
    setPriceIndexForTest(1);
    const { f, put, pool } = await setup();
    await put('r1', 'snapper', 10_000, 'resort');
    const s = await f.sell(N); expect(s.sold).toBe(1); expect(s.paid).toBe(Math.floor(fishSellValue(10_000)));
    await expect(f.sell(N)).rejects.toThrow(/Nothing to sell/);
    await put('f1', 'snapper', 10_000, 'factory');
    await expect(f.sell(N)).rejects.toThrow(/factory to a map warehouse/);
    expect((await pool.query("SELECT sold_at FROM fish_catches WHERE id = 'r1'")).rows[0].sold_at).toBeTruthy();
  });
});
