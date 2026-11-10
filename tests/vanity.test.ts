import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { PgCasinoStore, START_CHIPS, getBank, resetBank } from '../server/casino-store';
import { Fleet, setFleet } from '../server/fleet';
import { Vanity, setVanity } from '../server/vanity';
import { setPriceIndexForTest } from '../server/price-index';
import { SINK_DEBIT_GAMES, sinkLoss } from '../shared/sinkRoom';
import { SHOUT_COOLDOWN_MS, SHOUT_PRICE, VANITY_FIREWORKS, VANITY_LIVERIES, VANITY_TITLES } from '../shared/vanity';
import { fleetModel } from '../shared/fleet';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });

describe('Vanity Desk', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); setVanity(null); setFleet(null); });

  it('prices titles, fireworks, liveries and the shout-out as drafted, and counts them as sinks', () => {
    expect(VANITY_TITLES.map((t) => t.price)).toEqual([50_000, 150_000, 500_000]);
    expect(VANITY_FIREWORKS.map((t) => t.price)).toEqual([5_000, 25_000, 100_000]);
    expect(new Set(VANITY_LIVERIES.map((t) => t.price))).toEqual(new Set([40_000]));
    expect(SHOUT_PRICE).toBe(15_000);
    expect(SINK_DEBIT_GAMES.has('vanity')).toBe(true);
    expect(sinkLoss([{ game: 'vanity', amount: -50_000 }, { game: 'admin', amount: 50_000 }])).toBe(50_000);
  });

  it('sells titles, equips one, and scales by the price index (Postgres)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool));
    const v = new Vanity(pool); await v.init(); setVanity(v);
    setPriceIndexForTest(2);
    await fund('QA-V', 100_000);
    const before = getBank().account('QA-V').chips;
    const r = await v.buyTitle('QA-V', 'tycoon');
    expect(r.price).toBe(100_000);
    expect(getBank().account('QA-V').chips).toBe(before - 100_000);
    expect(await v.equippedTitle('QA-V')).toBe('Tycoon');
    expect(v.liveTitle('QA-V')).toBe('Tycoon');
    await expect(v.buyTitle('QA-V', 'tycoon')).rejects.toThrow(/already own/);
    await fund('QA-V', 300_000);
    await v.buyTitle('QA-V', 'magnate');
    expect(await v.equippedTitle('QA-V')).toBe('Magnate');
    await v.equipTitle('QA-V', 'tycoon');
    expect(await v.equippedTitle('QA-V')).toBe('Tycoon');
    await v.equipTitle('QA-V', null);
    expect(await v.equippedTitle('QA-V')).toBe(null);
    expect(db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'vanity' ORDER BY amount`).map((x) => Number(x.amount))).toEqual([-300_000, -100_000]);
  });

  it('refuses a title buy when the wallet cannot cover it, leaving the balance unchanged', async () => {
    const v = new Vanity(null); setVanity(v);
    const before = getBank().account('QA-Broke').chips;
    await expect(v.buyTitle('QA-Broke', 'billionaire')).rejects.toThrow(/Not enough chips/);
    expect(getBank().account('QA-Broke').chips).toBe(before);
    expect(await v.ownedTitles('QA-Broke')).toEqual([]);
  });

  it('launches fireworks and applies a 40k livery to an owned yacht', async () => {
    const f = new Fleet(null); setFleet(f);
    const v = new Vanity(null); setVanity(v);
    const yacht = fleetModel('yacht', 'boat')!.price;
    await fund('QA-V', yacht + 5_000 + 40_000 - START_CHIPS);
    const boat = await f.buy('QA-V', 'boat', 'yacht');
    const fw = await v.fireworks('QA-V', 'sparkler');
    expect(fw.id).toBe('sparkler'); expect(fw.price).toBe(5_000);
    const liv = await v.buyLivery('QA-V', 'goldleaf');
    expect(liv.price).toBe(40_000);
    await v.applyLivery('QA-V', liv.id, boat.id);
    expect((await v.ownedLiveries('QA-V'))[0]).toMatchObject({ liveryId: 'goldleaf', craftId: boat.id });
    await expect(v.applyLivery('QA-V', liv.id, 'nope')).rejects.toThrow(/yacht or jet/);
  });

  it('posts a paid shout-out once an hour', async () => {
    let now = Date.parse('2026-11-10T18:00:00Z');
    const v = new Vanity(null, () => now); setVanity(v);
    await fund('QA-V', 15_000);
    const r = await v.shout('QA-V', 'Hello Chud Hub');
    expect(r.price).toBe(15_000);
    expect(r.text).toBe('Hello Chud Hub');
    expect(getBank().account('QA-V').chips).toBe(START_CHIPS);
    await fund('QA-V', 15_000);
    await expect(v.shout('QA-V', 'Again?')).rejects.toThrow(/shout again/);
    now += SHOUT_COOLDOWN_MS;
    const r2 = await v.shout('QA-V', 'Round two');
    expect(r2.text).toBe('Round two');
  });
});
