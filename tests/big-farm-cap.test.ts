import { describe, expect, it } from 'vitest';
import { newDb, DataType } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { properties } from '../shared/realEstate';
import { bigFarms, isBigFarmN, MAX_BIG_FARMS } from '../shared/bigFarms';

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); db.public.registerFunction({ name: 'to_timestamp', args: [DataType.float], returns: DataType.timestamptz, implementation: (s: number) => new Date(s * 1000) });
  const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  const re = new RealEstate(pool, () => bank, () => Date.parse('2026-11-04T12:00:00Z')); await re.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  return { re, bank, fund };
}
const big = () => properties().filter((p) => /^cf:\d+$/.test(p.id) && isBigFarmN(Number(p.id.slice(3))));
const smallFields = () => properties().filter((p) => /^cf:\d+$/.test(p.id) && !isBigFarmN(Number(p.id.slice(3))));

describe('Big Farm cap: max 1 per account', () => {
  it('the cap is 1 and all eight Big Farms (20/24/30) are covered', () => {
    expect(MAX_BIG_FARMS).toBe(1);
    expect(big()).toHaveLength(8);
    expect(new Set(bigFarms().map((f) => f.size))).toEqual(new Set([20, 24, 30]));
  });
  it('a second Big Farm purchase fails with a clear error and charges nothing', async () => {
    const s = await setup(); await s.fund('Ann', 50_000_000);
    const [a, b] = big();
    await s.re.buy('Ann', a!.id);
    const before = s.bank.account('Ann').chips;
    await expect(s.re.buy('Ann', b!.id)).rejects.toThrow(/already own a Big Farm/);
    expect(s.bank.account('Ann').chips).toBe(before);
    expect(await s.re.ownedBigFarms('Ann')).toEqual([a!.id]);
    // another player can still buy one
    await s.fund('Bob', 50_000_000); await s.re.buy('Bob', b!.id);
  });
  it('parallel Big Farm buys by one account: only one wins', async () => {
    const s = await setup(); await s.fund('Cat', 50_000_000);
    const [a, b] = big();
    const r = await Promise.allSettled([s.re.buy('Cat', a!.id), s.re.buy('Cat', b!.id)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await s.re.ownedBigFarms('Cat')).toHaveLength(1);
  });
  it('small countryside fields are unchanged: a Big Farm owner can still buy them', async () => {
    const s = await setup(); await s.fund('Dee', 50_000_000);
    await s.re.buy('Dee', big()[0]!.id);
    const [f1, f2] = smallFields(); await s.re.buy('Dee', f1!.id); await s.re.buy('Dee', f2!.id);
    expect(await s.re.ownedCount('Dee')).toBe(3);
  });
});
