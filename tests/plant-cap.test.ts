import { beforeEach, describe, expect, it } from 'vitest';
import { plantCapBonusFromPaid, plantCapToBase } from '../shared/plantCap';
import { plantCapBonus, plantCapPaid, recordPlantSeed, resetPlantCapForTest } from '../server/plant-cap';
import { houseRoom } from '../server/house-room';
import { getMines, resetMines } from '../server/mines';
import { resetBank } from '../server/casino-store';
import { resetFarmGuardForTest } from '../server/farmGuard';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { farmPlots } from './farm-helpers';
import { HOUSE_DAILY_BASE } from '../shared/mines';

const T0 = Date.parse('2026-11-10T00:26:50Z'); // 6:26:50 PM CST Nov 9 — after that cap-day reset

beforeEach(() => { resetBank(); resetPlantCapForTest(); resetFarmGuardForTest(); });

describe('planting house-cap bonus', () => {
  it('gives back 100% of chips actually paid, floored, and matches the sunflower example', () => {
    expect(plantCapBonusFromPaid(293_400)).toBe(293_400); // 900 sunflowers at 326
    expect(plantCapBonusFromPaid(11)).toBe(11);
    expect(plantCapBonusFromPaid(0)).toBe(0);
    expect(plantCapBonusFromPaid(-10)).toBe(0);
    expect(plantCapToBase(293_400, 1)).toBe(293_400);
    expect(plantCapToBase(293_400, 2)).toBe(146_700);
  });

  it('is per player, uses the cap day, is idempotent on a ledger key, and nets out refunds', () => {
    recordPlantSeed('Conner', { game: 'farm_seed', amount: -293_400, key: 'farm_seed:conner:1' }, T0);
    expect(plantCapPaid('Conner', T0)).toBe(293_400);
    expect(plantCapBonus('Conner', T0)).toBe(293_400);
    recordPlantSeed('Conner', { game: 'farm_seed', amount: -293_400, key: 'farm_seed:conner:1' }, T0); // same charge
    expect(plantCapBonus('Conner', T0)).toBe(293_400);
    recordPlantSeed('Gus', { game: 'farm_seed', amount: -100, key: 'farm_seed:gus:1' }, T0);
    expect(plantCapBonus('Gus', T0)).toBe(100);
    expect(plantCapBonus('Conner', T0)).toBe(293_400);
    recordPlantSeed('Conner', { game: 'farm_seed', amount: 293_400, memo: 'reverted' }, T0);
    expect(plantCapBonus('Conner', T0)).toBe(0);
    expect(plantCapBonus('Conner', T0 + 86_400_000)).toBe(0); // next cap day
  });

  it('adds the bonus to house-room cap and house-sale room, shown as base cap + planting bonus', () => {
    resetMines();
    recordPlantSeed('Conner', { game: 'farm_seed', amount: -293_400, key: 'farm_seed:conner:2' }, T0);
    const r = houseRoom('Conner', T0);
    expect(r.plantBonus).toBe(293_400);
    expect(r.baseCap).toBe(Math.floor(HOUSE_DAILY_BASE * r.index));
    expect(r.cap).toBe(r.baseCap + 293_400);
    expect(r.left).toBe(r.baseCap + 293_400);
    const q = getMines().quoteItems('Conner', T0, []);
    expect(q.plantBonus).toBe(293_400);
    expect(q.capBase).toBeCloseTo(r.baseCap / (r.index || 1) + 293_400 / (r.index || 1), 6);
  });

  it('credits only a successful plant, not a failed one, and uses the chips actually charged', async () => {
    const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db);
    const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    let now = T0; const clock = () => now;
    const re = new RealEstate(pool, () => bank, clock); await re.init();
    const farm = new Farm(pool, () => bank, clock); await farm.init();
    const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
    const small = farmPlots().find((p) => p.cols * p.rows === 16)!; const id = `f:${small.n}`;
    await fund('Conner', 1_000_000);
    await expect(farm.plant('Conner', id, 'wheat', [0])).rejects.toThrow(/do not own/);
    expect(plantCapBonus('Conner', T0)).toBe(0);
    await re.buy('Conner', id);
    const before = bank.account('Conner').chips;
    const r = await farm.plant('Conner', id, 'wheat', [0, 1, 2, 3]);
    expect(r.cost).toBe(before - bank.account('Conner').chips);
    expect(r.cost).toBeGreaterThan(0);
    expect(plantCapPaid('Conner', T0)).toBe(r.cost);
    expect(plantCapBonus('Conner', T0)).toBe(r.cost);
    await expect(farm.plant('Conner', id, 'wheat', [0])).rejects.toThrow(/already planted/);
    expect(plantCapPaid('Conner', T0)).toBe(r.cost); // failed plant did not add
  });
});

describe('house-cap UI copy', () => {
  it('shows Base cap and planting bonus in the factory desk and player profile', async () => {
    const { readFileSync } = await import('node:fs');
    const factory = readFileSync('client/src/components/FactoryPanel.tsx', 'utf8');
    const profile = readFileSync('client/src/components/PlayerProfile.tsx', 'utf8');
    expect(factory).toMatch(/Base cap/);
    expect(factory).toMatch(/planting bonus/);
    expect(factory).toMatch(/factory-plant-cap/);
    expect(factory).toMatch(/100% of seed chips you pay today is added to this cap/);
    expect(factory).not.toMatch(/50% of seed chips you pay today is added to this cap/);
    expect(profile).toMatch(/Base cap/);
    expect(profile).toMatch(/planting bonus/);
  });
});
