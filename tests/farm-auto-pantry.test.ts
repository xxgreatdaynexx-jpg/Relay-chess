import { beforeEach, describe, expect, it } from 'vitest';
import { resetFarmGuardForTest } from '../server/farmGuard';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { farmPlots } from '../shared/farm';
import { setCropFailChanceForTest } from '../shared/farm';
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
  const small = farmPlots().find((p) => p.cols * p.rows === 16)!; const id = `f:${small.n}`;
  return { pool, bank, re, farm, fund, id, setNow: (t: number) => { now = t; }, db };
}

beforeEach(() => { setCropFailChanceForTest(0); resetFarmGuardForTest(); });

describe('farm auto-harvest to pantry', () => {
  it('persists pantry destination; sell-harvest and pantry are mutually exclusive', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Pat', plot.price + 5000); await s.re.buy('Pat', s.id);
    const a = await s.farm.setAuto('Pat', s.id, { pantry: true, plant: false, crop: 'wheat' });
    expect(a.auto).toEqual({ harvest: true, pantry: true, plant: false, crop: 'wheat' });
    const v = await s.farm.view(s.id, 'Pat');
    expect(v.auto).toEqual({ harvest: true, pantry: true, plant: false, crop: 'wheat' });
    const b = await s.farm.setAuto('Pat', s.id, { harvest: true, plant: false, crop: 'wheat' });
    expect(b.auto.harvest).toBe(true); expect(b.auto.pantry).toBe(false);
    const c = await s.farm.setAuto('Pat', s.id, { pantry: true });
    expect(c.auto.harvest).toBe(true); expect(c.auto.pantry).toBe(true);
    const d = await s.farm.setAuto('Pat', s.id, { harvest: false });
    expect(d.auto.harvest).toBe(false); expect(d.auto.pantry).toBe(false);
  });

  it('autoSweep with pantry leaves crops on the field when pantry storage is offline (never sells them)', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Pat', plot.price + 5000); await s.re.buy('Pat', s.id);
    await s.farm.plant('Pat', s.id, 'wheat', [0, 1, 2]);
    await s.farm.setAuto('Pat', s.id, { pantry: true, plant: false, crop: 'wheat' });
    s.setNow(T0 + 11 * M);
    const n = await s.farm.autoSweep();
    // LocStore not loaded in this test → pantry harvest FarmError → tiles remain, no chip sell
    expect((await s.pool.query('SELECT count(*)::int AS n FROM farm_tiles WHERE plot_id = $1', [s.id])).rows[0].n).toBe(3);
    expect(s.bank.account('Pat').chips).toBeGreaterThan(0); // still has leftover chips; no harvest credit path
    void n;
  });
});
