import { beforeEach, describe, expect, it } from 'vitest';
import { resetFarmGuardForTest } from '../server/farmGuard';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { setPriceIndexForTest } from '../server/price-index';
import { farmPlots } from './farm-helpers';
import { CROP_FAIL_CHANCE, cropFailSalt, cropTileFailed, harvestFailedNote, setCropFailChanceForTest } from '../shared/farm';
import { propertyById } from '../shared/realEstate';

const T0 = Date.parse('2026-11-01T12:00:00Z');
const M = 60_000;

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const clock = () => now;
  const re = new RealEstate(pool, () => bank, clock); await re.init();
  const farm = new Farm(pool, () => bank, clock); await farm.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const small = farmPlots().find((p) => p.cols * p.rows === 16)!; const id = `f:${small.n}`;
  return { db, bank, re, farm, fund, chips, id, setNow: (t: number) => { now = t; }, tile: (n: number) => db.public.one(`SELECT failed FROM farm_tiles WHERE plot_id = '${id}' AND tile = ${n}`) };
}

describe('crop tile fail chance', () => {
  beforeEach(() => { resetFarmGuardForTest(); setPriceIndexForTest(1); setCropFailChanceForTest(null); });

  it('default chance is 1% and the hash is deterministic for a salt', () => {
    expect(CROP_FAIL_CHANCE).toBe(0.01);
    const a = cropTileFailed(cropFailSalt('nonce-a', 3, 'wheat'));
    const b = cropTileFailed(cropFailSalt('nonce-a', 3, 'wheat'));
    expect(a).toBe(b);
    const other = cropTileFailed(cropFailSalt('nonce-b', 3, 'wheat'));
    // different salt is allowed to match, but the function must be stable
    expect(typeof other).toBe('boolean');
    expect(harvestFailedNote(0)).toBe('');
    expect(harvestFailedNote(1)).toBe(' 1 tile failed.');
    expect(harvestFailedNote(2)).toBe(' 2 tiles failed.');
  });

  it('rolls at plant time, stores the result, and does not pay crop or seed refund on harvest', async () => {
    setCropFailChanceForTest(1);
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Gus', plot.price + 1000); await s.re.buy('Gus', s.id);
    const before = s.chips('gus');
    await s.farm.plant('Gus', s.id, 'wheat', [0, 1]);
    expect(s.chips('gus')).toBe(before - 20);
    expect(s.tile(0).failed).toBe(true); expect(s.tile(1).failed).toBe(true);
    const v = await s.farm.view(s.id, 'Gus');
    expect(v.tiles.every((t) => t.failed && t.stage === 'failed')).toBe(true);
    s.setNow(T0 + 10 * M);
    const r = await s.farm.harvest('Gus', s.id) as { harvested: number; paid: number; failed: number };
    expect(r).toMatchObject({ harvested: 0, paid: 0, failed: 2 });
    expect(s.chips('gus')).toBe(before - 20); // no seed refund
    expect((await s.farm.view(s.id, 'Gus')).tiles).toHaveLength(0);
  });

  it('grandfathers existing tiles with a null failed column (no retroactive roll)', async () => {
    setCropFailChanceForTest(0);
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Gus', plot.price + 1000); await s.re.buy('Gus', s.id);
    await s.farm.plant('Gus', s.id, 'wheat', [0]);
    s.db.public.none(`UPDATE farm_tiles SET failed = NULL WHERE plot_id = '${s.id}'`);
    setCropFailChanceForTest(1);
    const v = await s.farm.view(s.id, 'Gus');
    expect(v.tiles[0]!.failed).toBe(false);
    expect(v.tiles[0]!.stage).not.toBe('failed');
    s.setNow(T0 + 10 * M);
    const r = await s.farm.harvest('Gus', s.id) as { harvested: number; paid: number; failed: number };
    expect(r.failed).toBe(0);
    expect(r.harvested).toBeGreaterThan(0);
    expect(r.paid).toBeGreaterThan(0);
  });

  it('pantry harvest also drops failed tiles with no crop', async () => {
    setCropFailChanceForTest(1);
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Gus', plot.price + 1000); await s.re.buy('Gus', s.id);
    await s.farm.plant('Gus', s.id, 'wheat', [0, 1, 2]);
    s.setNow(T0 + 10 * M);
    const r = await s.farm.harvest('Gus', s.id, undefined, undefined, true) as { harvested: number; paid: number; failed: number; pantry?: Record<string, number> };
    expect(r.failed).toBe(3);
    expect(r.harvested).toBe(0);
    expect(r.paid).toBe(0);
  });
});
