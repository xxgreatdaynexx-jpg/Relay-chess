// Property valuation: every consumer values an owned parcel at the price actually paid (shared propertyValue), after a
// normal buy and after a hostile buyout. Covers Real estate mine(), Bank playerAssets (the same total wealth tax adds to chips for net worth),
// player profile, Daily Report, property tax basis, and the economy total (playerValue -> daily_economy -> house-sell cap).
import { describe, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';
vi.mock('../server/popups', () => ({ sendPopup: vi.fn(async () => ({ online: false })) }));
const holder = vi.hoisted(() => ({ re: null as unknown }));
vi.mock('../server/realEstate', async (orig) => ({ ...(await orig<object>()), getRealEstate: () => holder.re }));
import { CasinoBank, PgCasinoStore, resetBank } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Economy, setEconomyForTest, type EconSource } from '../server/economy';
import { MemorySnapshots, buildDailyReport, setSnapshotStore } from '../server/daily-report';
import { buildPlayerProfile } from '../server/player-profile';
import { BUYOUT_PROTECT_MS } from '../shared/royalty';
import { propertyById, propertyValue, sellBackOf, taxBasisOf, taxOf } from '../shared/realEstate';

const T0 = Date.parse('2026-11-01T12:00:00Z');
const LM = 'lm:mine';
const src = (): EconSource => {
  const empty = () => ({ skins: [], stacks: [], machines: [] }); // fresh each call: live()/playerAssets() add keys to it
  return { cash: async () => 0, holdings: async () => empty(), holdingsOf: async () => empty(), sales: async () => [], flows: async () => [], cashAt: async () => 0,
    firstLedgerAt: async () => null, days: async () => [], saveDay: async () => {} };
};

async function setup() {
  resetBank(); setSnapshotStore(new MemorySnapshots());
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const re = new RealEstate(pool, () => bank, () => now); await re.init(); holder.re = re;
  const econ = new Economy(src(), () => now); setEconomyForTest(econ);
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  return { re, econ, fund, setNow: (t: number) => { now = t; }, now: () => now };
}

/** What each consumer says `name`'s property is worth. */
async function consumers(s: Awaited<ReturnType<typeof setup>>, name: string) {
  const mine = await s.re.mine(name);
  const assets = await s.econ.playerAssets(name, s.now());
  const profile = await buildPlayerProfile(name, { account: async () => ({ name }), now: s.now, db: () => null, online: () => false } as never);
  const report = JSON.stringify(await buildDailyReport(name, null, s.now()));
  return {
    panel: mine.reduce((a, p) => a + propertyValue(p.paid, p.list), 0), // Real estate panel (client) formula
    mine: mine.reduce((a, p) => a + p.value, 0),
    bank: assets?.categories.find((x) => x.key === 'property')?.value ?? 0,
    profile: (profile!.properties as Array<{ value: number }>).reduce((a, p) => a + p.value, 0),
    taxBasis: mine.reduce((a, p) => a + taxBasisOf(p.paid, p.list), 0),
    tax: mine.reduce((a, p) => a + p.tax, 0),
    report,
  };
}

describe('property value: one basis (price paid) across consumers', () => {
  it('normal buy, then hostile buyout: Bank, profile, wealth-tax assets, Daily Report, panel, tax and economy total agree', async () => {
    const s = await setup();
    const list = propertyById(LM)!.price;
    await s.fund('Alice', 10 * list); const paid = (await s.re.buy('Alice', LM)).price;
    let c = await consumers(s, 'Alice');
    expect(c).toMatchObject({ panel: paid, mine: paid, bank: paid, profile: paid, taxBasis: paid, tax: taxOf(paid) });
    expect(c.report).toContain(String(paid));
    expect((await s.re.playerValue()).value).toBe(paid);

    s.setNow(T0 + BUYOUT_PROTECT_MS); await s.fund('Bob', 10 * list); const bought = (await s.re.buyout('Bob', LM)).price;
    expect(bought).toBe(2 * paid); expect(bought).not.toBe(list);
    c = await consumers(s, 'Bob');
    expect(c).toMatchObject({ panel: bought, mine: bought, bank: bought, profile: bought, taxBasis: bought, tax: taxOf(bought) });
    expect(c.report).toContain(String(bought));
    expect((await s.econ.playerAssets('Bob', s.now()))!.total).toBe(bought); // wealth tax net worth = chips + this total
    expect((await consumers(s, 'Alice')).bank).toBe(0); // the bought-out owner no longer counts it
    expect((await s.re.playerValue()).value).toBe(bought); // economy total -> house-sell cap input
    // sell-back stays deliberately on the city basis (anti-arbitrage), not the valuation
    expect(sellBackOf(Math.min(bought, paid))).toBe(sellBackOf(paid));
  });
});
