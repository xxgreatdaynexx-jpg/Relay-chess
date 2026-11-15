import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { checkFarmAction, resetFarmGuardForTest } from '../server/farmGuard';
import { LocStore, setLocStore } from '../server/locstock';
import { propertyById } from '../shared/realEstate';
import { cropById, farmPlots, orchardTree } from '../shared/farm';
import { orchardId, orchardPlots } from '../shared/orchard';
import { PANTRY_MAX } from '../shared/cooking';
import { RESORT_WAREHOUSE } from '../shared/inventoryLocations';

// Hub sleeps overnight (UTC-6); 18:00Z is mid-day so autoSweep runs.
const T0 = Date.parse('2026-11-01T18:00:00Z');
const M = 60_000; const H = 60 * M;

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const clock = () => now;
  const re = new RealEstate(pool, () => bank, clock); await re.init();
  const farm = new Farm(pool, () => bank, clock); await farm.init();
  const ls = new LocStore(pool as never); await ls.init(); setLocStore(ls);
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const tiles = async (id: string) => (await pool.query('SELECT count(*)::int AS n FROM farm_tiles WHERE plot_id = $1', [id])).rows[0].n as number;
  return { pool, bank, re, farm, fund, ls, tiles, setNow: (t: number) => { now = t; } };
}

beforeEach(() => { resetFarmGuardForTest(); });
afterEach(() => { setLocStore(new LocStore(null)); });

describe('pantry harvest fills what fits', () => {
  it('a nearly full pantry takes the tiles that fit and leaves the rest ripe on the field', async () => {
    const s = await setup(); const id = 'rf:1'; const plot = propertyById(id)!;
    await s.fund('Isle', plot.price + 50_000); await s.re.buy('Isle', id);
    const pine = cropById('pineapple')!;
    await s.farm.plant('Isle', id, 'pineapple', [0, 1, 2, 3]);
    s.setNow(T0 + pine.grow + M);
    const per = (await s.farm.harvest('Isle', id, [0], undefined, true)).harvested; // one tile's yield
    s.ls.applyMem('Isle', [{ loc: RESORT_WAREHOUSE, item: 'food:pineapple', delta: PANTRY_MAX - per - s.ls.qty('Isle', RESORT_WAREHOUSE, 'food:pineapple') - 1 }]);
    s.setNow(T0 + pine.grow + 2 * M);
    const h = await s.farm.harvest('Isle', id, undefined, undefined, true) as { harvested: number; left: number };
    expect(h.harvested).toBeGreaterThan(0);
    expect(h.left).toBeGreaterThan(0);
    expect(s.ls.qty('Isle', RESORT_WAREHOUSE, 'food:pineapple')).toBeLessThanOrEqual(PANTRY_MAX);
    expect(await s.tiles(id)).toBe(h.left);
    // Completely full: refused with a clear message, crops stay.
    await expect(s.farm.harvest('Isle', id, undefined, undefined, true)).rejects.toThrow(/pantry is full.*wait on the field/i);
    expect(await s.tiles(id)).toBe(h.left);
  });
});

describe('auto sweep and the farm rate limit', () => {
  it('harvests every auto plot in one sweep and leaves the owner\'s manual harvest budget alone', async () => {
    const s = await setup(); const plots = farmPlots().slice(0, 3).map((p) => `f:${p.n}`);
    let need = 0; for (const id of plots) need += propertyById(id)!.price;
    await s.fund('Pat', need + 100_000);
    for (const id of plots) { await s.re.buy('Pat', id); await s.farm.plant('Pat', id, 'wheat', [0]); s.setNow(T0 + 2_000 * (plots.indexOf(id) + 1)); }
    for (const id of plots) await s.farm.setAuto('Pat', id, { harvest: true, plant: false, crop: 'wheat' });
    s.setNow(T0 + cropById('wheat')!.grow + H);
    await s.farm.autoSweep();
    for (const id of plots) expect(await s.tiles(id), id).toBe(0);
    // The sweep spent none of the player's tokens: a manual action right now is still allowed.
    expect(checkFarmAction('harvest', 'pat', T0 + cropById('wheat')!.grow + H + 10)).toBeNull();
  });
});

describe('orchard auto-harvest', () => {
  it('turns on with a stale city seed and picks ripe fruit on the sweep', async () => {
    const s = await setup(); const id = orchardId(orchardPlots()[0]!.n); const plot = propertyById(id)!;
    await s.fund('Ora', plot.price + 200_000); await s.re.buy('Ora', id);
    // Before the fix the client sent the default 'wheat' seed and the server refused the toggle.
    const a = await s.farm.setAuto('Ora', id, { harvest: true, pantry: false, plant: false, crop: 'wheat' });
    expect(a.auto).toMatchObject({ harvest: true, crop: 'apple' });
    expect((await s.farm.view(id, 'Ora')).auto?.crop).toBe('apple');
    await expect(s.farm.setAuto('Ora', id, { plant: true, crop: 'wheat' })).rejects.toThrow(/fruit trees/i);
    const apple = orchardTree('apple')!;
    await s.farm.plant('Ora', id, 'apple', [0, 1]);
    s.setNow(T0 + apple.grow + H);
    const before = s.bank.account('Ora').chips;
    await s.farm.autoSweep();
    expect(s.bank.account('Ora').chips).toBeGreaterThan(before);
    const rows = (await s.pool.query('SELECT matured FROM farm_tiles WHERE plot_id = $1', [id])).rows as Array<{ matured: boolean }>;
    expect(rows).toHaveLength(2); // trees stay planted
    expect(rows.every((r) => r.matured)).toBe(true);
  });
});
