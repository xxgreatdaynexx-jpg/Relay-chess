import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { PgCasinoStore, START_CHIPS, getBank, resetBank } from '../server/casino-store';
import { Fleet, jetUpkeep, setFleet } from '../server/fleet';
import { Travel } from '../server/travel';
import { setPriceIndexForTest } from '../server/price-index';
import { JETS, MAX_JETS, fleetModel } from '../shared/fleet';
import { GRACE_DAYS } from '../shared/realEstate';
import { SINK_DEBIT_GAMES, sinkLoss } from '../shared/sinkRoom';
import { resetPopups } from '../server/popups';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });
const DAY = 86_400_000; const T0 = Date.parse('2026-11-01T12:00:00Z');

describe('Private jets (#11)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); resetPopups(); });
  it('catalog: four jets, upkeep high and rising; upkeep is a sink, buys are not', () => {
    expect(JETS.map((j) => j.id)).toEqual(['citation', 'g700', 'global', 'chudone']);
    expect(JETS.map((j) => j.upkeep)).toEqual([6_000, 18_000, 36_000, 60_000]);
    expect(SINK_DEBIT_GAMES.has('jet_upkeep')).toBe(true); expect(SINK_DEBIT_GAMES.has('jet_buy')).toBe(false); expect(SINK_DEBIT_GAMES.has('boat_buy')).toBe(false);
    expect(sinkLoss([{ game: 'jet_upkeep', amount: -6_000 }, { game: 'jet_buy', amount: -1_000_000 }])).toBe(6_000);
    setPriceIndexForTest(2); expect(jetUpkeep('g700')).toBe(36_000);
  });
  it('jet owners fly to the resort with no ticket; others pay', async () => {
    const f = new Fleet(null); setFleet(f); const t = new Travel(null);
    const price = fleetModel('citation', 'jet')!.price; await fund('QA-Jet', price + 10_000);
    const before = getBank().account('QA-Jet').chips; await f.buy('QA-Jet', 'jet', 'citation');
    expect(getBank().account('QA-Jet').chips).toBe(before - price);
    const r = await t.fly('QA-Jet'); expect(r.fee).toBe(0); expect((r as { jet?: string }).jet).toBe(fleetModel('citation')!.name);
    expect(getBank().account('QA-Jet').chips).toBe(before - price);
    const n = await t.fly('QA-NoJet'); expect(n.fee).toBeGreaterThan(0); expect(getBank().account('QA-NoJet').chips).toBe(START_CHIPS - n.fee);
    setFleet(null);
  });
  it(`caps at ${MAX_JETS} jets`, async () => {
    const f = new Fleet(null); await fund('QA-Cap', 10_000_000);
    for (let i = 0; i < MAX_JETS; i++) await f.buy('QA-Cap', 'jet', 'citation');
    await expect(f.buy('QA-Cap', 'jet', 'citation')).rejects.toThrow(/already own/);
  });
  it('daily upkeep (Postgres): paid once per day atomically, arrears when broke, repossessed at GRACE_DAYS', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool));
    let now = T0; const f = new Fleet(pool, () => now); await f.init();
    const popups = resetPopups();
    const price = fleetModel('citation', 'jet')!.price; await fund('QA-Up', price + 6_000 - START_CHIPS + 0);
    await f.buy('QA-Up', 'jet', 'citation'); expect(getBank().account('QA-Up').chips).toBe(6_000);
    expect((await f.runUpkeep()).paid).toBe(0); // bought today: first bill is tomorrow
    now += DAY; expect(await f.runUpkeep()).toMatchObject({ paid: 1, charged: 6_000 });
    expect(await f.runUpkeep()).toMatchObject({ paid: 0, unpaid: 0 }); // rerun same day is a no-op
    expect(getBank().account('QA-Up').chips).toBe(0);
    expect(db.public.many(`SELECT amount FROM wallet_transactions WHERE game = 'jet_upkeep'`).map((x) => Number(x.amount))).toEqual([-6_000]);
    expect(await popups.pending('QA-Up')).toHaveLength(0);
    for (let d = 1; d < GRACE_DAYS; d++) { now += DAY; expect(await f.runUpkeep()).toMatchObject({ unpaid: 1, repossessed: 0 }); }
    expect((await f.owned('QA-Up', 'jet'))[0]!.arrears).toBe(GRACE_DAYS - 1);
    const mid = await popups.pending('QA-Up');
    expect(mid[0]!.from).toBe('Chud Hub Private Hangar');
    expect(mid[0]!.text).toMatch(/1 of 3 unpaid days/);
    expect(mid.at(-1)!.text).toMatch(/last warning/i);
    expect(mid.at(-1)!.text).toMatch(/jet will be repossessed/);
    now += DAY; expect(await f.runUpkeep()).toMatchObject({ unpaid: 1, repossessed: 1 });
    expect(await f.owned('QA-Up', 'jet')).toHaveLength(0);
    const last = await popups.pending('QA-Up');
    expect(last.at(-1)!.from).toBe('Chud Hub Private Hangar');
    expect(last.at(-1)!.text).toMatch(/repossessed/);
    expect(last.at(-1)!.text).toMatch(/no refund/i);
  });
  it('paying clears arrears', async () => {
    let now = T0; const f = new Fleet(null, () => now); const price = fleetModel('citation', 'jet')!.price;
    await fund('QA-Ar', price - START_CHIPS); await f.buy('QA-Ar', 'jet', 'citation');
    now += DAY; expect((await f.runUpkeep()).unpaid).toBe(1); expect((await f.owned('QA-Ar'))[0]!.arrears).toBe(1);
    await fund('QA-Ar', 6_000); now += DAY; expect((await f.runUpkeep()).paid).toBe(1); expect((await f.owned('QA-Ar'))[0]!.arrears).toBe(0);
  });
});
