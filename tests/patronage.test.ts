import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { PgCasinoStore, START_CHIPS, getBank, resetBank } from '../server/casino-store';
import { Patronage } from '../server/patronage';
import { setPriceIndexForTest } from '../server/price-index';
import { PATRON_SLOTS } from '../shared/patronage';
import { SINK_DEBIT_GAMES, sinkLoss } from '../shared/sinkRoom';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });
const DAY = 86_400_000; const T0 = Date.parse('2026-11-10T18:00:00Z');

describe('City patronage', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });

  it('uses the drafted prices and is a pure sink', () => {
    expect(Object.fromEntries(PATRON_SLOTS.map((s) => [s.id, s.price]))).toEqual({
      plaza: 500_000, fireworks_dock: 250_000, festival: 150_000, monument: 1_000_000,
    });
    for (const s of PATRON_SLOTS) expect(s.termDays).toBe(7);
    expect(SINK_DEBIT_GAMES.has('patronage')).toBe(true);
    expect(sinkLoss([{ game: 'patronage', amount: -500_000 }, { game: 'mayor_filing', amount: -1 }])).toBe(500_001);
  });

  it('sells a week of naming rights, blocks mid-term takeovers, and allows renewals and expiry (Postgres)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool));
    let now = T0; const p = new Patronage(pool, () => now); await p.init();
    await fund('Ann', 500_000);
    const r = await p.buy('Ann', 'plaza');
    expect(r.price).toBe(500_000);
    expect(r.endsAt).toBe(T0 + 7 * DAY);
    expect(getBank().account('Ann').chips).toBe(START_CHIPS);
    expect(db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'patronage'`).map((x) => Number(x.amount))).toEqual([-500_000]);

    await fund('Bob', 500_000);
    await expect(p.buy('Bob', 'plaza')).rejects.toThrow(/Ann holds the City Plaza/);
    expect(getBank().account('Bob').chips).toBe(START_CHIPS + 500_000);

    await fund('Ann', 500_000);
    const renew = await p.buy('Ann', 'plaza');
    expect(renew.endsAt).toBe(T0 + 14 * DAY);

    now = T0 + 14 * DAY + 1;
    const take = await p.buy('Bob', 'plaza');
    expect(take.endsAt).toBe(now + 7 * DAY);
    const v = await p.view('Bob');
    const plaza = v.slots.find((s: { id: string }) => s.id === 'plaza')!;
    expect(plaza.patron).toMatchObject({ name: 'Bob', mine: true });
  });

  it('does not take chips when the buyer cannot afford a monument', async () => {
    const p = new Patronage(null);
    const before = getBank().account('Cy').chips;
    await expect(p.buy('Cy', 'monument')).rejects.toThrow(/Not enough chips/);
    expect(getBank().account('Cy').chips).toBe(before);
    expect(await p.grant('monument')).toBeNull();
  });

  it('indexes the festival price', async () => {
    let now = T0; const p = new Patronage(null, () => now);
    setPriceIndexForTest(2);
    await fund('Ann', 300_000);
    const r = await p.buy('Ann', 'festival');
    expect(r.price).toBe(300_000);
    expect((await p.view('Ann')).slots.find((s: { id: string }) => s.id === 'festival')!.price).toBe(300_000);
  });
});
