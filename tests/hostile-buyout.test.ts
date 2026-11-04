import { describe, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { BUYOUT_PROTECT_MS, buyoutPrice } from '../shared/royalty';
import { propertyById, sellBackOf } from '../shared/realEstate';
import { LAUNCH } from '../shared/launchPopup';

vi.mock('../server/popups', () => ({ sendPopup: vi.fn(async () => ({ online: false })) }));
import { sendPopup } from '../server/popups';

const T0 = Date.parse('2026-11-01T12:00:00Z');
async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const re = new RealEstate(pool, () => bank, () => now); await re.init();
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  const ledger = (key: string) => db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = '${key}' AND game = 'property_buyout' ORDER BY id`) as Array<{ amount: number }>;
  return { bank, re, fund, ledger, pool, setNow: (t: number) => { now = t; } };
}
const LM = 'lm:mine';

describe('hostile buyouts', () => {
  it('pays the owner 2x what they paid in one transaction, re-prices, and notifies them', async () => {
    const { bank, re, fund, ledger, setNow } = await setup();
    const list = propertyById(LM)!.price;
    await fund('Alice', 10 * list); const b = await re.buy('Alice', LM); const paid = b.price;
    await fund('Bob', 10 * list);
    await expect(re.buyout('Bob', LM)).rejects.toThrow(/protected/); // 24h window
    setNow(T0 + BUYOUT_PROTECT_MS);
    const aliceBefore = bank.account('Alice').chips; const bobBefore = bank.account('Bob').chips;
    const r = await re.buyout('Bob', LM);
    expect(r.price).toBe(buyoutPrice(paid)); expect(r.price).toBe(2 * paid);
    expect(bank.account('Alice').chips).toBe(aliceBefore + 2 * paid);
    expect(bank.account('Bob').chips).toBe(bobBefore - 2 * paid);
    expect(ledger('alice').map((x) => Number(x.amount))).toEqual([2 * paid]);
    expect(ledger('bob').map((x) => Number(x.amount))).toEqual([-2 * paid]);
    const o = (await re.owned()).find((x) => x.id === LM)!;
    expect(o.owner).toBe('Bob'); expect(o.price).toBe(2 * paid); expect(o.basis).toBe(paid);
    expect(vi.mocked(sendPopup)).toHaveBeenCalledWith('Alice', expect.any(String), expect.stringMatching(/Hostile buyout.*Bob/));
    // next buyout costs 2x that, after a fresh protection window
    await fund('Carol', 10 * list);
    await expect(re.buyout('Carol', LM)).rejects.toThrow(/protected/);
    setNow(T0 + 2 * BUYOUT_PROTECT_MS);
    expect((await re.buyout('Carol', LM)).price).toBe(4 * paid);
  });
  it('guards: no self-buyout, must afford it, landmarks only, unowned = buy normally', async () => {
    const { bank, re, fund, setNow } = await setup();
    const list = propertyById(LM)!.price;
    await expect(re.buyout('Bob', LM)).rejects.toThrow(/belongs to the city/);
    await fund('Alice', 10 * list); const paid = (await re.buy('Alice', LM)).price;
    setNow(T0 + BUYOUT_PROTECT_MS);
    await expect(re.buyout('alice', LM)).rejects.toThrow(/already own/);
    await fund('Poor', 2 * paid - 1);
    await expect(re.buyout('Poor', LM)).rejects.toThrow(/Not enough chips/);
    expect(bank.account('Poor').chips).toBe(2 * paid - 1);
    await expect(re.buyout('Poor', 'b:house:0:0')).rejects.toThrow(/Only monuments/);
    await expect(re.buyout('Poor', LM, paid)).rejects.toThrow(); // max below the price
  });
  it('city sell-back after a buyout is 70% of what the city was paid (no alt loop)', async () => {
    const { bank, re, fund, setNow } = await setup();
    const list = propertyById(LM)!.price;
    await fund('Alice', 10 * list); const paid = (await re.buy('Alice', LM)).price;
    setNow(T0 + BUYOUT_PROTECT_MS); await fund('Bob', 10 * list); await re.buyout('Bob', LM);
    const before = bank.account('Bob').chips; const s = await re.sell('Bob', LM);
    expect(s.chips).toBe(sellBackOf(paid)); expect(bank.account('Bob').chips).toBe(before + sellBackOf(paid));
  });
  it('launch popup announces it', () => {
    expect(JSON.stringify(LAUNCH)).toMatch(/Hostile buyouts/);
  });
});
