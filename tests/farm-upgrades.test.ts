import { beforeEach, describe, expect, it } from 'vitest';
import { resetFarmGuardForTest } from '../server/farmGuard';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { farmPlots, cropById } from './farm-helpers';
import { propertyById } from '../shared/realEstate';
import { combinedGrowMul, FARM_UPGRADES, fertilizerYieldBonus, greenhouseWither, MAX_UPGRADE_LEVEL, upgradePrice, yieldQty } from '../shared/farmUpgrades';
import { timerColor, timerFraction } from '../shared/turnTimer';

const T0 = Date.parse('2026-11-01T12:00:00Z'); const M = 60_000;
async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const clock = () => now;
  const re = new RealEstate(pool, () => bank, clock); await re.init();
  const farm = new Farm(pool, () => bank, clock); await farm.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const ledger = (key: string, game: string) => db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = '${key}' AND game = '${game}' ORDER BY id`) as Array<{ amount: number }>;
  const small = farmPlots().find((p) => p.cols * p.rows === 16)!; const id = `f:${small.n}`;
  return { db, bank, re, farm, fund, chips, ledger, id, setNow: (t: number) => { now = t; } };
}

beforeEach(() => { resetFarmGuardForTest(); });

describe('farm upgrades (request #6)', () => {
  it('prices scale with plot size, rise per level, min 500, null at max', () => {
    for (const u of FARM_UPGRADES) {
      expect(upgradePrice(u.id, 0, 16)).toBeGreaterThanOrEqual(500);
      expect(upgradePrice(u.id, 1, 120)!).toBeGreaterThan(upgradePrice(u.id, 0, 120)!);
      expect(upgradePrice(u.id, 2, 120)!).toBeGreaterThan(upgradePrice(u.id, 1, 120)!);
      expect(upgradePrice(u.id, MAX_UPGRADE_LEVEL, 16)).toBeNull();
    }
    expect(upgradePrice('sprinkler', 0, 16)).toBe(650);
  });
  it('sprinklers stack with the Farming perk but never below half the grow time; fertilizer/greenhouse effects', () => {
    expect(combinedGrowMul(1, 0)).toBe(1); expect(combinedGrowMul(1, 3)).toBeCloseTo(0.7); expect(combinedGrowMul(0.75, 3)).toBeCloseTo(0.525);
    expect(combinedGrowMul(0.5, 3)).toBe(0.5); expect(combinedGrowMul(0.75, 99)).toBeCloseTo(0.525);
    expect(fertilizerYieldBonus(3)).toBeCloseTo(0.3); expect(greenhouseWither(2, 2)).toBe(4);
    // yieldQty: floor + stable fractional chance (same salt → same qty; ~10% of salts give +1 at bonus 0.1)
    expect(yieldQty(0, 'a')).toBe(1); expect(yieldQty(1, 'a')).toBe(2);
    let hits = 0; for (let i = 0; i < 10_000; i++) if (yieldQty(0.1, `n${i}`) === 2) hits++;
    expect(hits / 10_000).toBeGreaterThan(0.07); expect(hits / 10_000).toBeLessThan(0.13);
    expect(yieldQty(0.1, 'same')).toBe(yieldQty(0.1, 'same'));
  });
  it('buying is owner-only, debits via farm_upgrade ledger exactly once, persists, and applies to growth, yield and wither', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Gus', plot.price + 20_000); await s.fund('Hal', 5000);
    await expect(s.farm.buyUpgrade('Gus', s.id, 'sprinkler')).rejects.toThrow(/do not own/);
    await s.re.buy('Gus', s.id);
    await expect(s.farm.buyUpgrade('Hal', s.id, 'sprinkler')).rejects.toThrow(/do not own/);
    await expect(s.farm.buyUpgrade('Gus', s.id, 'nope')).rejects.toThrow(/Unknown upgrade/);
    const before = s.chips('gus');
    const [a, b] = await Promise.allSettled([s.farm.buyUpgrade('Gus', s.id, 'sprinkler'), s.farm.buyUpgrade('Gus', s.id, 'sprinkler')]);
    // serialized per plot: both succeed as levels 1 and 2, never the same level twice
    const lv = [a, b].filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ level: number }>).value.level).sort();
    expect(lv).toEqual([1, 2]);
    expect(s.chips('gus')).toBe(before - 650 - 1450);
    expect(s.ledger('gus', 'farm_upgrade')).toEqual([{ amount: -650 }, { amount: -1450 }]);
    await s.farm.buyUpgrade('Gus', s.id, 'fertilizer'); await s.farm.buyUpgrade('Gus', s.id, 'greenhouse');
    const v = await s.farm.view(s.id, 'Gus'); expect(v.upgrades).toEqual({ sprinkler: 2, fertilizer: 1, greenhouse: 1 });
    // A fresh Farm on the same DB still sees them (Postgres is the source of truth).
    expect((await new Farm((s.farm as unknown as { pool: never }).pool, () => s.bank, () => T0).view(s.id, 'Gus')).upgrades).toEqual(v.upgrades);
    await s.farm.plant('Gus', s.id, 'wheat', [0]);
    const w = cropById('wheat')!; const t = (await s.farm.view(s.id, 'Gus')).tiles[0]!;
    expect(t.readyAt - T0).toBe(Math.round(w.grow * 0.8)); // sprinklers lvl 2 = 20% faster
    expect(t.witherAt - t.readyAt).toBe(36 * 60 * 60_000); // ripe window is at least 36 h (greenhouse 4x grow is shorter for wheat)
    s.setNow(t.readyAt);
    // Fertilizer L1 = +10% yield (not profit). Qty is 1 or 2 from the tile nonce; payout = seed refund + (qty*sellValue - seed).
    const row = (s.db.public.many(`SELECT tile, crop, nonce FROM farm_tiles WHERE plot_id = '${s.id}'`) as Array<{ tile: number; crop: string; nonce: string }>)[0]!;
    const qty = yieldQty(0.1, `${row.nonce}:${row.tile}:${row.crop}`);
    const sellV = w.sell * 0.95;
    const h = await s.farm.harvest('Gus', s.id);
    expect(h.harvested).toBe(qty);
    expect(h.paid).toBe(w.seed + Math.floor(qty * sellV - w.seed));
  });
  it('maxes out at level 3 and a new owner starts from zero', async () => {
    const s = await setup(); await s.fund('Gus', 100_000); await s.re.buy('Gus', s.id);
    for (let i = 0; i < 3; i++) await s.farm.buyUpgrade('Gus', s.id, 'greenhouse');
    await expect(s.farm.buyUpgrade('Gus', s.id, 'greenhouse')).rejects.toThrow(/maxed/);
    s.db.public.none(`UPDATE properties SET owner_key = 'hal', owner_name = 'Hal' WHERE id = '${s.id}'`);
    expect((await s.farm.view(s.id, 'Hal')).upgrades).toEqual({ sprinkler: 0, fertilizer: 0, greenhouse: 0 });
  });
  it('not enough chips charges nothing', async () => {
    const s = await setup(); const plot = propertyById(s.id)!; await s.fund('Gus', plot.price + 100); await s.re.buy('Gus', s.id);
    await expect(s.farm.buyUpgrade('Gus', s.id, 'fertilizer')).rejects.toThrow(/Not enough chips/);
    expect(s.ledger('gus', 'farm_upgrade')).toEqual([]);
  });
});

describe('casino turn-timer bar (request #7)', () => {
  it('drains from full to empty and turns red near the end', () => {
    expect(timerFraction(10_000, 10_000, 0)).toBe(1); expect(timerFraction(10_000, 10_000, 5000)).toBe(0.5);
    expect(timerFraction(10_000, 10_000, 12_000)).toBe(0); expect(timerFraction(10_000, 0, 0)).toBe(0);
    expect(timerColor(0.9)).not.toBe(timerColor(0.1)); expect(timerColor(0.1)).toBe('#e04040'); expect(timerColor(0.4)).toBe('#e0b030');
  });
});
