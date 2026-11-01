import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank } from '../server/casino-store';
import { Exchange, setExchange } from '../server/stocks';
import { Derivatives, setDerivs } from '../server/derivs';
import { Economy, setEconomyForTest, type EconSource } from '../server/economy';
import { MemorySnapshots, buildDailyReport, setSnapshotStore } from '../server/daily-report';
import { COMPANY_BY_TICKER, parseQty, quote } from '../shared/stocks';
import { FUND_BY_ID, fundQuote, shortClose } from '../shared/derivs';
import { INFLATION_LABELS, inflationView, type InflationStatsInput } from '../shared/inflation';

const T0 = Date.parse('2026-11-01T12:00:00Z');
const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };
const chips = (n: string) => getBank().account(n).chips;

describe('C: quantity validation (shared by client and server)', () => {
  it('accepts positive whole numbers only, with clear messages', () => {
    expect(parseQty('12')).toEqual({ ok: true, n: 12 });
    expect(parseQty(' 7 ')).toEqual({ ok: true, n: 7 });
    for (const bad of ['-5', '-0.5']) expect(parseQty(bad)).toMatchObject({ ok: false, error: expect.stringMatching(/negative/i) });
    for (const bad of ['1.5', '2.', '1e3']) expect(parseQty(bad)).toMatchObject({ ok: false });
    expect(parseQty('1.5')).toMatchObject({ error: expect.stringMatching(/whole/i) });
    for (const bad of ['', '0', 'abc', '1,000', NaN, Infinity]) expect(parseQty(bad as string)).toMatchObject({ ok: false });
    expect(parseQty('2000000')).toMatchObject({ ok: false });
    expect(parseQty('1.25', { decimals: 2 })).toEqual({ ok: true, n: 1.25 });
    expect(parseQty('1.255', { decimals: 2 })).toMatchObject({ ok: false });
    expect(parseQty('-1', { decimals: 2 })).toMatchObject({ ok: false });
  });
  it('server rejects "-5" and "1.5" instead of trading a stripped "5"/"15"', async () => {
    const e = new Exchange(null, () => T0); const n = 'QA-R7qty'; fund(n, 100_000);
    await expect(e.trade(n, 'buy', 'QRKL', '-5')).rejects.toThrow(/negative/i);
    await expect(e.trade(n, 'buy', 'QRKL', '1.5')).rejects.toThrow(/whole/i);
    await expect(e.trade(n, 'buy', 'QRKL', -5)).rejects.toThrow(/negative/i);
    expect(chips(n)).toBe(100_000);
    const d = new Derivatives(e, null, () => T0);
    await expect(d.tradeFund(n, 'buy', 'CH100', -2)).rejects.toThrow(/negative/i);
    await expect(d.openShort(n, 'QRKL', 1.5)).rejects.toThrow(/whole/i);
    expect(chips(n)).toBe(100_000);
  });
});

describe('F: quotes match charges', () => {
  it('fund buy charges exactly the fundQuote the UI shows', async () => {
    const e = new Exchange(null, () => T0); const d = new Derivatives(e, null, () => T0); const n = 'QA-R7fund'; fund(n, 50_000);
    for (const [id, u] of [['CH100', 1], ['CHTEK', 1], ['CHTEK', 7], ['CH100', 3.33]] as const) {
      const f = FUND_BY_ID.get(id)!; const nav = (await d.funds()).find((x) => x.id === id)!.nav;
      const shown = fundQuote(f, nav, 'buy', u).total; const before = chips(n);
      const r = await d.tradeFund(n, 'buy', id, u);
      expect(r.total).toBe(shown); expect(before - chips(n)).toBe(shown);
    }
  });
  it('closing a short pays exactly the close value shown in the portfolio', async () => {
    const e = new Exchange(null, () => T0); const d = new Derivatives(e, null, () => T0); const n = 'QA-R7short'; fund(n, 50_000);
    const o = await d.openShort(n, 'QRKL', 3);
    const row = (await d.portfolio(n)).shorts.find((s) => s.id === o.id)!;
    const before = chips(n); const c = await d.closeShort(n, o.id);
    expect(c.payout).toBe(row.closeValue); expect(chips(n) - before).toBe(row.closeValue);
    const comp = COMPANY_BY_TICKER.get('QRKL')!; expect(shortClose(comp, { collateral: 100, proceeds: 50, shares: 1, fees: 1 }, 40).q).toEqual(quote(comp, 40, 'buy', 1));
  });
});

function econSource(): EconSource {
  const empty = { skins: [], stacks: [], machines: [] };
  return {
    cash: async () => 50_000, holdings: async () => empty, holdingsOf: async () => empty, sales: async () => [], flows: async () => [], cashAt: async () => 40_000,
    firstLedgerAt: async () => null, days: async () => [{ day: '2026-10-31', cash: 40_000, assets: 0, total: 40_000, estPct: 0, flows: null, source: 'snapshot' }], saveDay: async () => {},
  };
}

describe('D: Daily Report assets include funds and options', () => {
  beforeEach(() => { resetBank(); setSnapshotStore(new MemorySnapshots()); setEconomyForTest(new Economy(econSource(), () => T0)); });
  afterEach(() => { setDerivs(null); setExchange(null); setEconomyForTest(null); });
  it('values fund units and options in the player total', async () => {
    const e = new Exchange(null, () => T0); const d = new Derivatives(e, null, () => T0); setExchange(e); setDerivs(d);
    const n = 'QA-R7assets'; fund(n, 20_000);
    await d.tradeFund(n, 'buy', 'CH100', 10);
    const p = await d.portfolio(n); expect(p.totals.funds).toBeGreaterThan(0);
    const r = await buildDailyReport(n, null, T0);
    expect(r.me.assets).toBeGreaterThanOrEqual(p.totals.funds);
    expect(r.me.categories.map((c: { key: string }) => c.key)).toContain('funds');
  });
});

describe('E: one inflation source for Daily Report and Economy tab', () => {
  beforeEach(() => { resetBank(); setSnapshotStore(new MemorySnapshots()); });
  afterEach(() => setEconomyForTest(null));
  it('Daily Report inflation equals inflationView(Economy.stats()) at the same moment', async () => {
    const econ = new Economy(econSource(), () => T0); setEconomyForTest(econ);
    const stats = await econ.stats() as InflationStatsInput;
    const r = await buildDailyReport('QA-R7infl', null, T0);
    expect(r.economy!.inflation).toEqual(inflationView(stats));
    expect(r.economy!.inflation.cashToday).toBe(25);
  });
  it('smoothed value is null (shown as a label, not "—/day") without history', () => {
    const v = inflationView({ at: 1, change: { cash: 1, total: 2 }, inflation: { cash7: null, total7: null }, priceIndex: { emaPct: null } });
    expect(v.smoothed).toBeNull(); expect(INFLATION_LABELS.smoothedEmpty).not.toMatch(/—/);
  });
});
