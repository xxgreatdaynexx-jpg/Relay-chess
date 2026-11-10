import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { PgCasinoStore, START_CHIPS, getBank, resetBank } from '../server/casino-store';
import { Fleet, boatUpkeep } from '../server/fleet';
import { setPriceIndexForTest } from '../server/price-index';
import { BOATS, fleetModel } from '../shared/fleet';
import { GRACE_DAYS } from '../shared/realEstate';
import { SINK_DEBIT_GAMES, sinkLoss } from '../shared/sinkRoom';
import { resetPopups } from '../server/popups';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });
const DAY = 86_400_000; const T0 = Date.parse('2026-11-01T12:00:00Z');

describe('Luxury boat upkeep', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); resetPopups(); });

  it('yachts and superyachts have daily luxury upkeep; skiffs and sportfishers do not', () => {
    expect(BOATS.find((b) => b.id === 'yacht')?.upkeep).toBe(3_000);
    expect(BOATS.find((b) => b.id === 'superyacht')?.upkeep).toBe(15_000);
    expect(BOATS.find((b) => b.id === 'megayacht')?.upkeep).toBe(40_000);
    expect(BOATS.find((b) => b.id === 'skiff')?.upkeep ?? 0).toBe(0);
    expect(BOATS.find((b) => b.id === 'sportfisher')?.upkeep ?? 0).toBe(0);
    expect(SINK_DEBIT_GAMES.has('boat_upkeep')).toBe(true);
    expect(SINK_DEBIT_GAMES.has('boat_buy')).toBe(false);
    expect(sinkLoss([{ game: 'boat_upkeep', amount: -3_000 }, { game: 'boat_buy', amount: -450_000 }])).toBe(3_000);
    setPriceIndexForTest(2); expect(boatUpkeep('yacht')).toBe(6_000); expect(boatUpkeep('skiff')).toBe(0);
  });

  it('does not bill a yacht on the purchase day, then charges indexed upkeep once per UTC day', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool));
    let now = T0; const f = new Fleet(pool, () => now); await f.init();
    const price = fleetModel('yacht', 'boat')!.price;
    await fund('QA-Y', price + 3_000 - START_CHIPS);
    await f.buy('QA-Y', 'boat', 'yacht');
    expect(getBank().account('QA-Y').chips).toBe(3_000);
    expect((await f.runUpkeep()).paid).toBe(0);
    now += DAY; expect(await f.runUpkeep()).toMatchObject({ paid: 1, charged: 3_000, unpaid: 0 });
    expect(await f.runUpkeep()).toMatchObject({ paid: 0, unpaid: 0 });
    expect(getBank().account('QA-Y').chips).toBe(0);
    expect(db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'boat_upkeep'`).map((x) => Number(x.amount))).toEqual([-3_000]);
    const info = (await f.view('QA-Y')).owned.find((c: { model: string }) => c.model === 'yacht') as { upkeepInfo: { perDay: number; arrears: number; graceDays: number } };
    expect(info.upkeepInfo).toMatchObject({ perDay: 3_000, arrears: 0, graceDays: GRACE_DAYS });
  });

  it('never pushes the wallet negative; missed bills warn privately, then repossess after grace', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool));
    const popups = resetPopups();
    let now = T0; const f = new Fleet(pool, () => now); await f.init();
    const price = fleetModel('yacht', 'boat')!.price;
    await fund('QA-Y', price - START_CHIPS);
    await f.buy('QA-Y', 'boat', 'yacht');
    expect(getBank().account('QA-Y').chips).toBe(0);
    now += DAY; expect(await f.runUpkeep()).toMatchObject({ unpaid: 1, repossessed: 0, paid: 0 });
    expect(getBank().account('QA-Y').chips).toBe(0);
    const first = await popups.pending('QA-Y');
    expect(first).toHaveLength(1);
    expect(first[0]!.from).toBe('Chud Resort Marina');
    expect(first[0]!.text).toMatch(/1 of 3 unpaid days/);
    expect(first[0]!.text).toMatch(/3,000/);
    expect(first[0]!.text).not.toMatch(/public chat/i);

    for (let d = 2; d < GRACE_DAYS; d++) {
      now += DAY; expect(await f.runUpkeep()).toMatchObject({ unpaid: 1, repossessed: 0 });
    }
    expect((await f.owned('QA-Y', 'boat'))[0]!.arrears).toBe(GRACE_DAYS - 1);
    const mid = await popups.pending('QA-Y');
    expect(mid.at(-1)!.text).toMatch(/last warning/i);

    now += DAY; expect(await f.runUpkeep()).toMatchObject({ unpaid: 1, repossessed: 1 });
    expect(await f.owned('QA-Y', 'boat')).toHaveLength(0);
    expect(getBank().account('QA-Y').chips).toBe(0);
    const last = await popups.pending('QA-Y');
    expect(last.at(-1)!.text).toMatch(/repossessed/);
    expect(last.at(-1)!.text).toMatch(/no refund/i);
  });

  it('paying a missed yacht bill clears arrears', async () => {
    let now = T0; const f = new Fleet(null, () => now);
    const yPrice = fleetModel('yacht', 'boat')!.price;
    await fund('QA-Ar', yPrice - START_CHIPS); await f.buy('QA-Ar', 'boat', 'yacht');
    now += DAY; expect((await f.runUpkeep()).unpaid).toBe(1); expect((await f.owned('QA-Ar', 'boat'))[0]!.arrears).toBe(1);
    await fund('QA-Ar', 3_000); now += DAY; expect((await f.runUpkeep()).paid).toBe(1); expect((await f.owned('QA-Ar', 'boat'))[0]!.arrears).toBe(0);
  });

  it('does not bill skiffs or sportfishers', async () => {
    let now = T0; const f = new Fleet(null, () => now);
    const sPrice = fleetModel('skiff', 'boat')!.price;
    const fPrice = fleetModel('sportfisher', 'boat')!.price;
    await fund('QA-Sk', sPrice + fPrice - START_CHIPS);
    await f.buy('QA-Sk', 'boat', 'skiff'); await f.buy('QA-Sk', 'boat', 'sportfisher');
    const before = getBank().account('QA-Sk').chips;
    now += DAY; const r = await f.runUpkeep();
    expect(r.paid + r.unpaid).toBe(0);
    expect(getBank().account('QA-Sk').chips).toBe(before);
    expect(await f.owned('QA-Sk', 'boat')).toHaveLength(2);
  });

  it('bills a superyacht 15,000 a day', async () => {
    let now = T0; const f = new Fleet(null, () => now);
    const sy = fleetModel('superyacht', 'boat')!.price;
    await fund('QA-Sy', sy + 15_000 - START_CHIPS); await f.buy('QA-Sy', 'boat', 'superyacht');
    now += DAY; expect(await f.runUpkeep()).toMatchObject({ paid: 1, charged: 15_000 });
    expect(getBank().account('QA-Sy').chips).toBe(0);
  });
});
