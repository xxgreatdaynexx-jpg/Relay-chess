import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { resetFarmGuardForTest } from '../server/farmGuard';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { LocStore, setLocStore, getLocStore } from '../server/locstock';
import { propertyById } from '../shared/realEstate';
import { cropById } from '../shared/farm';
import { PANTRY_MAX } from '../shared/cooking';
import { RESORT_WAREHOUSE } from '../shared/inventoryLocations';
import { fertilizerYieldBonus, yieldQty } from '../shared/farmUpgrades';
import { RESORT_HARVEST_MUL } from '../shared/resort';

const T0 = Date.parse('2026-11-01T12:00:00Z');
const M = 60_000;

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const clock = () => now;
  const re = new RealEstate(pool, () => bank, clock); await re.init();
  const farm = new Farm(pool, () => bank, clock); await farm.init();
  // Same DB as farm so pantry adjust() can delete tiles in one transaction (resort food is not city-packed).
  const ls = new LocStore(pool as never); await ls.init(); setLocStore(ls);
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  return { pool, bank, re, farm, fund, ls, setNow: (t: number) => { now = t; }, id: 'rf:1' as const };
}

beforeEach(() => { resetFarmGuardForTest(); });
afterEach(() => { setLocStore(new LocStore(null)); });

describe('resort plantation pantry (pt2094u)', () => {
  it('manual To pantry lands food:<crop> in the Resort Warehouse and clears tiles', async () => {
    const s = await setup();
    const plot = propertyById(s.id)!;
    await s.fund('Isle', plot.price + 50_000); await s.re.buy('Isle', s.id);
    const pine = cropById('pineapple')!;
    await s.farm.plant('Isle', s.id, 'pineapple', [0, 1]);
    s.setNow(T0 + pine.grow + M);
    const before = s.bank.account('Isle').chips;
    const h = await s.farm.harvest('Isle', s.id, undefined, undefined, true);
    expect(h.paid).toBe(0);
    expect(h.harvested).toBeGreaterThanOrEqual(2);
    expect('pantry' in h && h.pantry).toBeTruthy();
    const pantry = (h as { pantry: Record<string, number> }).pantry;
    expect(pantry).toMatchObject({ pineapple: expect.any(Number) });
    expect(pantry.pineapple).toBe(h.harvested);
    expect(s.ls.qty('Isle', RESORT_WAREHOUSE, 'food:pineapple')).toBe(h.harvested);
    expect(s.ls.qty('Isle', 'warehouse', 'food:pineapple')).toBe(0); // no city leak
    expect((await s.pool.query('SELECT count(*)::int AS n FROM farm_tiles WHERE plot_id = $1', [s.id])).rows[0].n).toBe(0);
    expect(s.bank.account('Isle').chips).toBe(before); // no chip sale
  });

  it('full Resort Warehouse pantry leaves crops on the field (never sells them)', async () => {
    const s = await setup();
    const plot = propertyById(s.id)!;
    await s.fund('Isle', plot.price + 50_000); await s.re.buy('Isle', s.id);
    const pine = cropById('pineapple')!;
    await s.farm.plant('Isle', s.id, 'pineapple', [0]);
    // Fill the resort pantry for pineapple
    s.ls.applyMem('Isle', [{ loc: RESORT_WAREHOUSE, item: 'food:pineapple', delta: PANTRY_MAX }]);
    s.setNow(T0 + pine.grow + M);
    await expect(s.farm.harvest('Isle', s.id, undefined, undefined, true)).rejects.toThrow(/pantry is full/i);
    expect((await s.pool.query('SELECT count(*)::int AS n FROM farm_tiles WHERE plot_id = $1', [s.id])).rows[0].n).toBe(1);
    expect(s.ls.qty('Isle', RESORT_WAREHOUSE, 'food:pineapple')).toBe(PANTRY_MAX);
  });

  it('autoSweep pantry works without being at the resort (offline like city); factory sink still blocked', async () => {
    const s = await setup();
    const plot = propertyById(s.id)!;
    await s.fund('Isle', plot.price + 50_000); await s.re.buy('Isle', s.id);
    const pine = cropById('pineapple')!;
    await s.farm.plant('Isle', s.id, 'pineapple', [0]);
    await s.farm.setAuto('Isle', s.id, { pantry: true, plant: false, crop: 'pineapple' });
    // Hub sleeps 01:00–07:00 UTC-6; T0 (12:00Z) is asleep — advance past wake so autoSweep runs.
    s.setNow(T0 + pine.grow + 3 * 60 * M);
    const n = await s.farm.autoSweep();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(s.ls.qty('Isle', RESORT_WAREHOUSE, 'food:pineapple')).toBeGreaterThanOrEqual(1);
    expect((await s.pool.query('SELECT count(*)::int AS n FROM farm_tiles WHERE plot_id = $1', [s.id])).rows[0].n).toBe(0);
    // Replant and prove factory sink still refuses cross-map
    await s.farm.plant('Isle', s.id, 'pineapple', [0]);
    s.setNow(T0 + pine.grow * 2 + 4 * 60 * M);
    await expect(s.farm.harvest('Isle', s.id, undefined, { write: async () => {}, after: () => {} } as never, false)).rejects.toThrow(/ship them/i);
  });

  it('fertilizer yield bonus applies on resort pantry harvest', async () => {
    const s = await setup();
    const plot = propertyById(s.id)!;
    await s.fund('Isle', plot.price + 200_000); await s.re.buy('Isle', s.id);
    for (let i = 0; i < 3; i++) await s.farm.buyUpgrade('Isle', s.id, 'fertilizer');
    expect(fertilizerYieldBonus(3)).toBeCloseTo(0.3);
    const pine = cropById('pineapple')!;
    await s.farm.plant('Isle', s.id, 'pineapple', [0]);
    const row = (await s.pool.query('SELECT tile, crop, nonce FROM farm_tiles WHERE plot_id = $1', [s.id])).rows[0] as { tile: number; crop: string; nonce: string };
    const expectQty = yieldQty(0.3, `${row.nonce}:${row.tile}:${row.crop}`) * RESORT_HARVEST_MUL;
    s.setNow(T0 + pine.grow + M);
    const h = await s.farm.harvest('Isle', s.id, undefined, undefined, true);
    expect(h.harvested).toBe(expectQty);
    expect(s.ls.qty('Isle', RESORT_WAREHOUSE, 'food:pineapple')).toBe(expectQty);
  });
});
