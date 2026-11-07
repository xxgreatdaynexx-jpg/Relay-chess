import { harvestSells } from './helpers/farmHaul';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetFarmGuardForTest } from '../server/farmGuard';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { farmPlots, cropById } from './farm-helpers';
import { propertyById } from '../shared/realEstate';
import { fertCost, fertDef, HAND_BATCH, MACHINES, passLimit, tileYield } from '../shared/farmWork';
import { perkText } from '../shared/skillPerks';

const T0 = Date.parse('2026-11-01T12:00:00Z'); const M = 60_000;
async function setup(level = 1) {
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const clock = () => now; const lv = { v: level };
  const re = new RealEstate(pool, () => bank, clock); await re.init();
  const farm = harvestSells(new Farm(pool, () => bank, clock, () => 0.99, async () => lv.v), pool, () => bank); await farm.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const ledger = (key: string, game: string) => db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = '${key}' AND game = '${game}' ORDER BY id`) as Array<{ amount: number }>;
  const small = farmPlots().find((p) => p.cols * p.rows === 16)!; const id = `f:${small.n}`;
  const own = async (name: string, extra: number) => { await fund(name, propertyById(id)!.price + extra); await re.buy(name, id); };
  return { db, bank, farm, fund, chips, ledger, id, own, lv, setNow: (t: number) => { now = t; } };
}
const wheat = cropById('wheat')!;
async function growWheat(s: Awaited<ReturnType<typeof setup>>, name: string, fert?: string) {
  await s.farm.plow(name, s.id, [0, 1, 2, 3]); await s.farm.plant(name, s.id, 'wheat', [0, 1, 2, 3]);
  if (fert) await s.farm.fertilize(name, s.id, fert, [0, 1, 2, 3]);
  s.setNow(T0 + wheat.grow + M); return (await s.farm.harvest(name, s.id)) as { paid: number; bonus: number };
}

beforeEach(() => resetFarmGuardForTest());

describe('farming rework: steps the player does', () => {
  it('plough -> seed -> harvest; by hand a pass covers HAND_BATCH tiles; harvesting resets the soil', async () => {
    const s = await setup(); await s.own('Gus', 10_000);
    await expect(s.farm.plow('Gus', s.id, [0, 1, 2, 3, 4])).rejects.toThrow(/By hand you can work 4/);
    await expect(s.farm.plant('Gus', s.id, 'wheat', [0])).rejects.toThrow(/Plough/);
    expect(s.ledger('gus', 'farm_seed')).toEqual([]);
    expect((await s.farm.plow('Gus', s.id, [0, 1])).plowed).toBe(2);
    await expect(s.farm.plow('Gus', s.id, [0, 1])).rejects.toThrow(/Already ploughed/);
    expect((await s.farm.view(s.id, 'Gus')).plowed).toEqual([0, 1]);
    await s.farm.plant('Gus', s.id, 'wheat', [0, 1]);
    expect((await s.farm.view(s.id, 'Gus')).plowed).toEqual([]);
    s.setNow(T0 + wheat.grow); await s.farm.harvest('Gus', s.id);
    await expect(s.farm.plant('Gus', s.id, 'wheat', [0])).rejects.toThrow(/Plough/);
    expect(passLimit('harvest', {}, 120)).toBe(HAND_BATCH); expect(passLimit('harvest', { harvester: true }, 120)).toBe(120);
  });
});

describe('machinery is paid only through the wallet + ledger', () => {
  it('buys once via farm_machine (a double click charges once), refuses without chips, then works the whole field', async () => {
    const s = await setup(); const tractor = MACHINES.find((m) => m.id === 'tractor')!;
    await s.own('Gus', tractor.price + 500);
    const before = s.chips('gus');
    const [a, b] = await Promise.allSettled([s.farm.buyMachine('Gus', 'tractor'), s.farm.buyMachine('Gus', 'tractor')]);
    expect([a, b].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(s.ledger('gus', 'farm_machine')).toEqual([{ amount: -tractor.price }]);
    expect(s.chips('gus')).toBe(before - tractor.price);
    await expect(s.farm.buyMachine('Gus', 'harvester')).rejects.toThrow(/Not enough chips/);
    await expect(s.farm.buyMachine('Gus', 'jetpack')).rejects.toThrow(/Unknown machine/);
    expect(s.ledger('gus', 'farm_machine')).toHaveLength(1);
    expect((await s.farm.view(s.id, 'Gus')).machines).toEqual({ tractor: true });
    const all = Array.from({ length: 16 }, (_, i) => i);
    expect((await s.farm.plow('Gus', s.id, all)).plowed).toBe(16);
    // seeding the whole field still needs a seed drill
    await expect(s.farm.plant('Gus', s.id, 'strawberry', all)).rejects.toThrow(/Seed Drill/);
    // a fresh Farm on the same DB still sees the machine (Postgres is the source of truth)
    const f2 = new Farm((s.farm as unknown as { pool: never }).pool, () => s.bank, () => T0);
    expect(await f2.machines('Gus')).toEqual({ tractor: true });
  });
  it('the combine adds yield (+10%) and the seed drill speeds growth', async () => {
    const s = await setup(); await s.own('Gus', 200_000);
    await s.farm.buyMachine('Gus', 'harvester'); await s.farm.buyMachine('Gus', 'seeder');
    expect(s.ledger('gus', 'farm_machine').map((r) => r.amount)).toEqual([-60_000, -35_000]);
    await s.farm.plow('Gus', s.id, [0]); await s.farm.plant('Gus', s.id, 'wheat', [0]);
    const t = (await s.farm.view(s.id, 'Gus')).tiles[0]!; expect(t.readyAt - T0).toBe(Math.round(wheat.grow * 0.9));
    expect((await s.farm.view(s.id, 'Gus')).yieldBonus).toBeCloseTo(0.1);
  });
});

describe('fertilizer raises yield (#27)', () => {
  it('Super-Gro on 4 wheat tiles = +1.6 crops (1 with a high roll), charged per tile via farm_fertilizer', async () => {
    const plain = await setup(); await plain.own('Gus', 10_000); const p = await growWheat(plain, 'Gus');
    expect(p.paid).toBe(Math.floor(4 * wheat.sell * 0.95)); // farming -5% expect(p.bonus).toBe(0);
    const s = await setup(); await s.own('Gus', 10_000); const f = fertDef('supergro')!;
    const h = await growWheat(s, 'Gus', 'supergro');
    expect(s.ledger('gus', 'farm_fertilizer')).toEqual([{ amount: -4 * fertCost(f, wheat.sell) }]);
    expect(h.bonus).toBe(1); expect(h.paid).toBe(Math.floor(5 * wheat.sell * 0.95)); // farming -5%
  });
  it('only growing, unfertilized tiles; one dose per planting; no chips no dose', async () => {
    const s = await setup(); await s.own('Gus', 200);
    await expect(s.farm.fertilize('Gus', s.id, 'npk', [0])).rejects.toThrow(/growing crops/);
    await s.farm.plow('Gus', s.id, [0]); await s.farm.plant('Gus', s.id, 'sunflower', [0]).catch(() => {});
    await s.farm.plant('Gus', s.id, 'wheat', [0]).catch(() => {});
    await s.farm.fertilize('Gus', s.id, 'compost', [0]);
    await expect(s.farm.fertilize('Gus', s.id, 'npk', [0])).rejects.toThrow(/growing crops/);
    expect((await s.farm.view(s.id, 'Gus')).tiles[0]!.fert).toBe('compost');
    await expect(s.farm.fertilize('Gus', s.id, 'bogus', [0])).rejects.toThrow(/Unknown fertilizer/);
    expect(tileYield(0, 'npk', false)).toBeCloseTo(0.25); expect(fertCost(fertDef('npk')!, 100, true)).toBe(10);
  });
});

describe('Farming level gives bonus YIELD, not a better price', () => {
  it('level 99 harvests more crops at exactly the same per-crop price as level 1', async () => {
    const lo = await setup(1); await lo.own('Gus', 10_000); const a = await growWheat(lo, 'Gus');
    const hi = await setup(99); await hi.own('Gus', 10_000); const b = await growWheat(hi, 'Gus');
    expect(a.bonus).toBe(0); expect(b.bonus).toBe(1); // 4 tiles x 25%
    expect(a.paid).toBe(Math.floor(4 * wheat.sell * 0.95)); expect(b.paid).toBe(Math.floor(5 * wheat.sell * 0.95)); // same 0.95x per-crop price at both levels (farming -5%)
    const v = await hi.farm.view(hi.id, 'Gus'); expect(v.profitMul).toBe(1); expect(v.yieldBonus).toBeCloseTo(0.25);
    expect(perkText('farming', 99)).toMatch(/yield/i); expect(perkText('farming', 99)).not.toMatch(/price|profit/i);
  });
});
