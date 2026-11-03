import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { PgCasinoStore, START_CHIPS, getBank, resetBank } from '../server/casino-store';
import { Fleet, craftValue } from '../server/fleet';
import { setPriceIndexForTest } from '../server/price-index';
import { BOATS, bestBoat, fleetModel } from '../shared/fleet';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });
describe('Marina catalog', () => {
  it('four boats, rising price and range; best boat wins', () => {
    expect(BOATS.map((b) => b.id)).toEqual(['skiff', 'sportfisher', 'yacht', 'superyacht']);
    for (let i = 1; i < BOATS.length; i++) { expect(BOATS[i]!.price).toBeGreaterThan(BOATS[i - 1]!.price); expect(BOATS[i]!.zone!).toBeGreaterThanOrEqual(BOATS[i - 1]!.zone!); }
    expect(bestBoat([])).toEqual({ zone: 0, biteMul: 1, name: null });
    expect(bestBoat(['skiff', 'superyacht', 'yacht']).name).toBe('Chud Royale Superyacht');
    expect(fleetModel('skiff', 'jet')).toBeUndefined();
  });
});
describe('Fleet (boats)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  it('buys and sells back at 70% (memory), caps boats', async () => {
    const f = new Fleet(null);
    await expect(f.buy('QA-Boat', 'boat', 'skiff')).rejects.toThrow(/Not enough chips/);
    await fund('QA-Boat', 200_000); const a = await f.buy('QA-Boat', 'boat', 'skiff');
    expect(getBank().account('QA-Boat').chips).toBe(START_CHIPS + 200_000 - 30_000);
    expect((await f.boatOf('QA-Boat')).zone).toBe(1);
    const s = await f.sell('QA-Boat', a.id); expect(s.paid).toBe(21_000);
    expect((await f.boatOf('QA-Boat')).zone).toBe(0);
    await expect(f.buy('QA-Boat', 'boat', 'nope')).rejects.toThrow(/not in the Marina/);
  });
  it('writes fleet_owned + boat_buy ledger in one transaction (Postgres); price index applies', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool));
    setPriceIndexForTest(2); const f = new Fleet(pool); await f.init();
    await fund('QA-Pg', 300_000); const r = await f.buy('QA-Pg', 'boat', 'sportfisher'); expect(r.price).toBe(240_000);
    expect(db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'boat_buy'`).map((x) => Number(x.amount))).toEqual([-240_000]);
    expect(craftValue({ model: 'sportfisher', paid: 0 })).toBe(168_000);
    expect(await new Fleet(pool).valueOf('QA-Pg')).toBe(168_000);
    expect(await new Fleet(pool).values()).toBe(0); // QA excluded from economy totals
    await f.sell('QA-Pg', r.id);
    expect(db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'boat_sell'`).map((x) => Number(x.amount))).toEqual([168_000]);
    expect(db.public.many('SELECT * FROM fleet_owned')).toHaveLength(0);
  });
});
