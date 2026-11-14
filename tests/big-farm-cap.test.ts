import { describe, expect, it } from 'vitest';
import { newDb, DataType } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { FARM_MIGRATION } from '../server/farm';
import { properties } from '../shared/realEstate';
import { bigFarms, isBigFarmN } from '../shared/bigFarms';
import { FARMLAND_TILE_CAP } from '../shared/zoning';

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); db.public.registerFunction({ name: 'to_timestamp', args: [DataType.float], returns: DataType.timestamptz, implementation: (s: number) => new Date(s * 1000) });
  const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  const re = new RealEstate(pool, () => bank, () => Date.parse('2026-11-04T12:00:00Z')); await re.init(); await pool.query(FARM_MIGRATION);
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  return { db, re, bank, fund };
}
const big = () => properties().filter((p) => /^cf:\d+$/.test(p.id) && isBigFarmN(Number(p.id.slice(3))));
const smallFields = () => properties().filter((p) => /^cf:\d+$/.test(p.id) && !isBigFarmN(Number(p.id.slice(3))));
const sized = (n: number) => big().filter((p) => p.tiles === n * n);

describe('Big Farms: no per-account cap, 2,000-tile zoning still applies', () => {
  it('lists all twelve Big Farms (20/24/30), including the four northern plots, and has no per-player cap export', () => {
    expect(FARMLAND_TILE_CAP).toBe(2000);
    expect(big()).toHaveLength(12);
    expect(bigFarms()).toHaveLength(12);
    expect(new Set(bigFarms().map((f) => f.size))).toEqual(new Set([20, 24, 30]));
    expect(bigFarms().filter((f) => f.n >= 1008).map((f) => f.n)).toEqual([1008, 1009, 1010, 1011]);
    expect(isBigFarmN(1007)).toBe(true);
    expect(isBigFarmN(1011)).toBe(true);
    expect(isBigFarmN(1012)).toBe(false);
  });
  it('two 20×20 Big Farms (800 tiles) can both be bought by one account', async () => {
    const s = await setup(); await s.fund('Ann', 50_000_000);
    const [a, b] = sized(20);
    await s.re.buy('Ann', a!.id);
    const before = s.bank.account('Ann').chips;
    await s.re.buy('Ann', b!.id);
    expect(s.bank.account('Ann').chips).toBe(before - b!.price);
    expect((await s.re.ownedBigFarms('Ann')).sort()).toEqual([a!.id, b!.id].sort());
    await s.fund('Bob', 50_000_000); await s.re.buy('Bob', sized(20)[2]!.id);
    expect(await s.re.ownedBigFarms('Bob')).toEqual([sized(20)[2]!.id]);
  });
  it('a further Big Farm is refused once the 2,000-tile farmland cap would be exceeded, and nothing is charged', async () => {
    const s = await setup(); await s.fund('Cat', 50_000_000);
    const [a, b] = sized(30);
    const extra = sized(24)[0]!;
    await s.re.buy('Cat', a!.id);
    await s.re.buy('Cat', b!.id);
    expect((await s.re.ownedBigFarms('Cat')).sort()).toEqual([a!.id, b!.id].sort());
    const before = s.bank.account('Cat').chips;
    await expect(s.re.buy('Cat', extra.id)).rejects.toThrow(/Zoning cap: farmland is limited to 2,000 tiles/);
    expect(s.bank.account('Cat').chips).toBe(before);
    expect(await s.re.ownedBigFarms('Cat')).toHaveLength(2);
  });
  it('small countryside fields are unchanged: a Big Farm owner can still buy them under the tile cap', async () => {
    const s = await setup(); await s.fund('Dee', 50_000_000);
    await s.re.buy('Dee', sized(20)[0]!.id);
    const [f1, f2] = smallFields(); await s.re.buy('Dee', f1!.id); await s.re.buy('Dee', f2!.id);
    expect(await s.re.ownedCount('Dee')).toBe(3);
  });
});
