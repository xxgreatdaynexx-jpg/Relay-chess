import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { setPriceIndexForTest } from '../server/price-index';
import { CROPS, cropById, farmPayout, farmPlots, FARM_TIERS, FARM_X0, MIN_RIPE_MS, PARK_SAFE, ripeWindow, stageOf, WITHER_FACTOR } from './farm-helpers';
import { properties, propertyById } from '../shared/realEstate';
import { obbOverlap, PARK_AREA, PLATE } from '../shared/worldLayout';

const T0 = Date.parse('2026-11-01T12:00:00Z'); const M = 60_000;
async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const clock = () => now;
  const re = new RealEstate(pool, () => bank, clock); await re.init();
  const farm = new Farm(pool, () => bank, clock); await farm.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const ledger = (key: string, game: string) => db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = '${key}' AND game = '${game}' ORDER BY id`) as Array<{ amount: number }>;
  const small = farmPlots().find((p) => p.cols * p.rows === 16)!; const id = `f:${small.n}`;
  return { db, bank, re, farm, fund, chips, ledger, id, small, setNow: (t: number) => { now = t; } };
}

describe('farm district', () => {
  it('plots are farmland properties east of the plate, never overlapping each other or the Trailer Park; a small plot is a few days of login bonuses', () => {
    const plots = properties().filter((p) => p.type === 'farmland' && p.id.startsWith('f:'));
    expect(plots.length).toBe(farmPlots().length); expect(plots.length).toBeGreaterThanOrEqual(12);
    for (const p of plots) { expect(p.x - p.w / 2).toBeGreaterThanOrEqual(FARM_X0); expect(obbOverlap(p, PARK_AREA, 1)).toBe(false); }
    for (let i = 0; i < plots.length; i++) for (let j = i + 1; j < plots.length; j++) expect(obbOverlap(plots[i]!, plots[j]!, 0.5)).toBe(false);
    const prices = plots.map((p) => p.price).sort((a, b) => a - b);
    expect(prices[0]).toBeGreaterThanOrEqual(2000); expect(prices[0]).toBeLessThanOrEqual(5000); expect(prices[prices.length - 1]).toBeGreaterThanOrEqual(15_000);
    expect(new Set(farmPlots().map((p) => p.cols * p.rows)).size).toBeGreaterThan(5);
    expect(PARK_SAFE).toBe(true); expect(FARM_X0).toBeGreaterThanOrEqual(PLATE);
  });
  it('crops: 8-10, cheap/fast to slow/valuable, every crop profitable at full rate; wither after 2x the grow time', () => {
    expect(CROPS.length).toBeGreaterThanOrEqual(8); expect(CROPS.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < CROPS.length; i++) { expect(CROPS[i]!.grow).toBeGreaterThan(CROPS[i - 1]!.grow); expect(CROPS[i]!.seed).toBeGreaterThan(CROPS[i - 1]!.seed); }
    for (const c of CROPS) expect(c.sell).toBeGreaterThan(c.seed);
    const c = cropById('corn')!;
    expect(stageOf(c, 0, c.grow - 1)).toBe('growing'); expect(stageOf(c, 0, c.grow)).toBe('ready'); expect(stageOf(c, 0, c.grow + ripeWindow(c.grow) - 1)).toBe('ready'); expect(stageOf(c, 0, c.grow + ripeWindow(c.grow))).toBe('withered');
  });
  it('daily tiers: full, half, a tenth, then nothing (bounded profit per day)', () => {
    expect(farmPayout(500, 0)).toBe(500); expect(farmPayout(1000, 0)).toBe(1000); expect(farmPayout(200, 99_900)).toBe(100); expect(farmPayout(1000, 100_000)).toBe(0);
    expect(farmPayout(1e9, 0)).toBe(100_000); expect(FARM_TIERS.at(-1)!.rate).toBe(0);
  });
  it('only the owner can plant; seeds are paid via farm_seed; harvest pays exactly once via farm_harvest on the server clock', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Gus', plot.price + 1000); await s.fund('Hal', 1000);
    await expect(s.farm.plant('Gus', s.id, 'wheat', [0])).rejects.toThrow(/do not own/);
    await s.re.buy('Gus', s.id);
    await expect(s.farm.plant('Hal', s.id, 'wheat', [0])).rejects.toThrow(/do not own/);
    await s.farm.plant('Gus', s.id, 'wheat', [0, 1, 2, 3]);
    expect(s.chips('gus')).toBe(1000 - 40); expect(s.ledger('gus', 'farm_seed')).toEqual([{ amount: -40 }]);
    await expect(s.farm.plant('Gus', s.id, 'carrot', [3, 4])).rejects.toThrow(/already planted/);
    expect(s.chips('gus')).toBe(960);
    await expect(s.farm.harvest('Gus', s.id)).rejects.toThrow(/Nothing is ready/);
    s.setNow(T0 + 10 * M);
    const [a, b] = await Promise.allSettled([s.farm.harvest('Gus', s.id), s.farm.harvest('Gus', s.id)]);
    expect([a, b].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(s.chips('gus')).toBe(960 + 64); expect(s.ledger('gus', 'farm_harvest')).toEqual([{ amount: 64 }]);
    const v = await s.farm.view(s.id, 'Gus'); expect(v.tiles).toHaveLength(0); expect(v.today.gross).toBe(24); expect(v.mine).toBe(true);
    expect((await s.farm.view(s.id, 'Hal')).mine).toBe(false); // neighbours can look, not touch
  });
  it('withered crops pay nothing and can be cleared; harvest payouts follow the price index; a wallet never goes negative', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Ida', plot.price + 50); await s.re.buy('Ida', s.id);
    await expect(s.farm.plant('Ida', s.id, 'sunflower', [0])).rejects.toThrow(/Not enough chips/); expect(s.chips('ida')).toBe(50);
    await s.farm.plant('Ida', s.id, 'strawberry', [0, 1]);
    s.setNow(T0 + 4 * M + MIN_RIPE_MS);
    await expect(s.farm.harvest('Ida', s.id)).rejects.toThrow(/Nothing is ready/);
    expect((await s.farm.clear('Ida', s.id)).cleared).toBe(2);
    setPriceIndexForTest(1.5);
    try {
      await s.farm.plant('Ida', s.id, 'strawberry', [5]); expect(s.chips('ida')).toBe(40 - Math.round(5 * 1.5) + 0);
      s.setNow(T0 + 4 * M + MIN_RIPE_MS + 4 * M); const before = s.chips('ida');
      const r = await s.farm.harvest('Ida', s.id); expect(r.paid).toBe(Math.floor(8 * 1.5)); expect(s.chips('ida')).toBe(before + r.paid);
    } finally { setPriceIndexForTest(1); }
  });
  it('a new owner never inherits the previous owner\'s crops', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Jo', plot.price + 100); await s.fund('Kim', plot.price + 100);
    await s.re.buy('Jo', s.id); await s.farm.plant('Jo', s.id, 'wheat', [0]); await s.re.sell('Jo', s.id);
    await s.re.buy('Kim', s.id); s.setNow(T0 + 5 * M);
    expect((await s.farm.view(s.id, 'Kim')).tiles).toHaveLength(0);
    await expect(s.farm.harvest('Kim', s.id)).rejects.toThrow(/Nothing is ready/);
    await s.farm.plant('Kim', s.id, 'wheat', [0]); expect((await s.farm.view(s.id, 'Kim')).tiles).toHaveLength(1);
  });
});

describe('countryside fields farm like farmland (pt1250u)', () => {
  it('buy a cf: field, plant, harvest, sell back 70% of paid', async () => {
    const s = await setup(); const id = 'cf:0'; const plot = propertyById(id)!;
    await s.fund('Ida', plot.price + 1000); await s.re.buy('Ida', id);
    const v = await s.farm.view(id, 'Ida'); expect(v.mine).toBe(true); expect(v.cols * v.rows).toBeGreaterThan(20);
    await s.farm.plant('Ida', id, 'wheat', [0, 1]); s.setNow(T0 + 10 * 60_000); await s.farm.harvest('Ida', id);
    expect(s.ledger('ida', 'farm_harvest').length).toBe(1);
    const before = s.chips('ida'); await s.re.sell('Ida', id); expect(s.chips('ida') - before).toBe(Math.floor(plot.price * 0.7));
  });
  it('ripe crops last at least 36 hours (or 3x grow) before withering; long crops keep their longer window (request #19)', () => {
    const H = 60 * 60_000;
    for (const c of CROPS) { expect(ripeWindow(c.grow)).toBe(Math.max(36 * H, WITHER_FACTOR * c.grow)); expect(stageOf(c, 0, c.grow + 36 * H - 1)).toBe('ready'); }
    expect(ripeWindow(30 * 60_000)).toBe(36 * H); expect(ripeWindow(12 * H)).toBe(36 * H); expect(ripeWindow(16 * H)).toBe(48 * H); expect(ripeWindow(12 * H, 4)).toBe(48 * H); expect(WITHER_FACTOR).toBe(3);
  });
});
