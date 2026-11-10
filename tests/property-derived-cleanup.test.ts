import { beforeEach, describe, expect, it } from 'vitest';
import { resetFarmGuardForTest } from '../server/farmGuard';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { healStalePropertyDerived } from '../server/propertyDerived';
import { propertyById } from '../shared/realEstate';
import { farmPlots } from './farm-helpers';
import { buildPlayerProfile, type ProfileDeps } from '../server/player-profile';
import { GRACE_DAYS } from '../shared/realEstate';

const T0 = Date.parse('2026-11-01T12:00:00Z');
const DAY = 86_400_000;

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const clock = () => now;
  const re = new RealEstate(pool, () => bank, clock); await re.init();
  const farm = new Farm(pool, () => bank, clock); await farm.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const chips = (key: string) => Number(db.public.one(`SELECT chips FROM casino_players WHERE player_key = '${key}'`).chips);
  const small = farmPlots().find((p) => p.cols * p.rows === 16)!; const id = `f:${small.n}`;
  return { db, pool, bank, re, farm, fund, chips, id, setNow: (t: number) => { now = t; }, now: () => now };
}

const count = async (pool: { query: (s: string, a?: unknown[]) => Promise<{ rows: Array<{ n: number }> }> }, sql: string, args: unknown[] = []) =>
  Number((await pool.query(sql, args)).rows[0]?.n ?? 0);

beforeEach(() => resetFarmGuardForTest());

describe('selling a property clears derived farm records', () => {
  it('sell to the city drops tiles, upgrades, auto-farm and the plot from myPlots, net worth and the crop record; chips only change by the sell-back', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Jo', plot.price + 200);
    await s.re.buy('Jo', s.id);
    await s.farm.plant('Jo', s.id, 'wheat', [0, 1]);
    await s.farm.setAuto('Jo', s.id, { harvest: true, plant: true, crop: 'wheat' });
    await s.pool.query("INSERT INTO farm_upgrades (plot_id, kind, owner_key, level) VALUES ($1,'sprinkler','jo',2)", [s.id]);
    await s.pool.query('INSERT INTO farm_soil (plot_id, tile, owner_key) VALUES ($1,0,$2)', [s.id, 'jo']);
    expect(await s.farm.myPlots('Jo')).toEqual([s.id]);
    expect((await s.re.owned()).some((p) => p.id === s.id && p.owner.toLowerCase() === 'jo')).toBe(true);
    expect(await count(s.pool, 'SELECT COUNT(*) n FROM farm_tiles WHERE owner_key = $1', ['jo'])).toBe(2);
    const before = s.chips('jo');
    const sold = await s.re.sell('Jo', s.id);
    expect(s.chips('jo')).toBe(before + sold.chips);
    expect(await s.farm.myPlots('Jo')).toEqual([]);
    expect((await s.re.owned()).some((p) => p.id === s.id)).toBe(false);
    expect(await count(s.pool, 'SELECT COUNT(*) n FROM farm_tiles WHERE owner_key = $1', ['jo'])).toBe(0);
    expect(await count(s.pool, 'SELECT COUNT(*) n FROM farm_upgrades WHERE owner_key = $1', ['jo'])).toBe(0);
    expect(await count(s.pool, 'SELECT COUNT(*) n FROM farm_auto WHERE owner_key = $1', ['jo'])).toBe(0);
    expect(await count(s.pool, 'SELECT COUNT(*) n FROM farm_soil WHERE owner_key = $1', ['jo'])).toBe(0);
  });

  it('a self-heal from current deeds drops leftover rows without changing chips, and myPlots / crop records ignore them', async () => {
    const s = await setup();
    await s.fund('Kim', 10);
    const before = s.chips('kim');
    await s.pool.query("INSERT INTO farm_tiles (plot_id, tile, owner_key, crop, planted_at, nonce) VALUES ('cf:0',0,'kim','sunflower',$1,'stale')", [T0]);
    await s.pool.query("INSERT INTO farm_upgrades (plot_id, kind, owner_key, level) VALUES ('cf:0','sprinkler','kim',2)");
    await s.pool.query("INSERT INTO farm_auto (plot_id, owner_key, harvest, plant, crop) VALUES ('cf:0','kim',true,true,'sunflower')");
    // Reads must not show a farm the player does not own, even before the heal writes.
    expect(await s.farm.myPlots('Kim')).toEqual([]);
    const deps: ProfileDeps = { db: () => s.pool as never, account: async (k) => k === 'kim' ? { name: 'Kim' } : null, online: () => ({ online: false }), now: () => T0 };
    const prof = await buildPlayerProfile('Kim', deps);
    expect(prof!.farms).toEqual([]);
    expect(prof!.properties).toEqual([]);
    const healed = await healStalePropertyDerived(s.pool);
    expect(healed.tiles).toBe(1);
    expect(healed.upgrades).toBe(1);
    expect(healed.auto).toBe(1);
    expect(s.chips('kim')).toBe(before);
    expect(await count(s.pool, "SELECT COUNT(*) n FROM farm_tiles WHERE owner_key = 'kim'")).toBe(0);
    expect(await healStalePropertyDerived(s.pool)).toMatchObject({ tiles: 0, upgrades: 0, auto: 0 });
  });

  it('tax repossession clears the former owner\'s plantings the same way, with no sell-back', async () => {
    const s = await setup(); const plot = propertyById(s.id)!;
    await s.fund('Mel', plot.price + 40);
    await s.re.buy('Mel', s.id);
    await s.farm.plant('Mel', s.id, 'wheat', [0]);
    await s.pool.query('UPDATE properties SET arrears = $2, bought_at = $3 WHERE id = $1', [s.id, GRACE_DAYS - 1, T0 - DAY]);
    await s.pool.query("UPDATE casino_players SET chips = 0 WHERE player_key = 'mel'");
    s.setNow(T0 + GRACE_DAYS * DAY);
    const r = await s.re.runTax();
    expect(r.repossessed).toBe(1);
    expect(await s.re.ownerOf(s.id)).toBeNull();
    expect(await s.farm.myPlots('Mel')).toEqual([]);
    expect(await count(s.pool, "SELECT COUNT(*) n FROM farm_tiles WHERE plot_id = $1", [s.id])).toBe(0);
    expect(s.chips('mel')).toBe(0);
  });
});
