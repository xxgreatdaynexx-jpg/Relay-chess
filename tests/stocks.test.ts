import { describe, expect, it } from 'vitest';
import { getBank } from '../server/casino-store';
import { Exchange, activitySignal, dailyDrift, stepBase } from '../server/stocks';
import { COMPANIES, COMPANY_BY_TICKER, MAX_TRADE_IMPACT, SECTORS, TICK_MS, dailyEvents, maxOrderChips, quote } from '../shared/stocks';
import { valueHoldings } from '../server/economy';

const T0 = Date.parse('2026-10-31T12:00:00Z');
const mk = () => { let now = T0; const e = new Exchange(null, () => now); return { e, adv: (ms: number) => { now += ms; } }; };
const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };

describe('stock exchange data', () => {
  it('has 100 fictional companies with unique tickers across all sectors', () => {
    expect(COMPANIES).toHaveLength(100);
    expect(new Set(COMPANIES.map((c) => c.ticker)).size).toBe(100);
    for (const s of SECTORS) expect(COMPANIES.some((c) => c.sector === s.id)).toBe(true);
    for (const c of COMPANIES) { expect(c.start).toBeGreaterThan(1); expect(c.vol).toBeGreaterThan(0); expect(c.shares).toBeGreaterThan(0); }
  });
  it('schedules at least one deterministic event per company per day', () => {
    for (const c of COMPANIES) {
      const a = dailyEvents(c, '2026-10-31'); expect(a.length).toBeGreaterThanOrEqual(1); expect(dailyEvents(c, '2026-10-31')).toEqual(a);
      for (const ev of a) { expect(ev.at).toBeGreaterThanOrEqual(T0 - 12 * 3_600_000); expect(Math.abs(ev.move)).toBeLessThanOrEqual(c.vol * 2.5 + 1e-9); expect(ev.move > 0).toBe(ev.good); }
    }
  });
});

describe('pricing model', () => {
  it('caps drift and damps activity from few players', () => {
    const c = COMPANIES[0]!;
    expect(Math.abs(dailyDrift(c, 500, { players: 1, flow: 1, mines: 1, casino: 1, arena: 1, factory: 1, market: 1 }))).toBeLessThanOrEqual(0.03);
    expect(activitySignal(100000, 10, 1)).toBeCloseTo(1 / 3, 5);
    expect(activitySignal(100000, 10, 10)).toBe(1);
    expect(activitySignal(0, 1e9, 10)).toBe(-1);
  });
  it('mean-reverts toward the anchor', () => {
    const c = COMPANIES[0]!; let r = { base: c.start * 2, anchor: c.start };
    for (let i = 0; i < 2880 * 6; i++) r = stepBase(c, r, 0, 0, 0, 0);
    expect(r.base / c.start).toBeLessThan(1.3);
  });
  it('round trips lose to spread + fee, and impact is capped per trade', () => {
    const c = COMPANIES[5]!; const b = quote(c, 100, 'buy', 10); const s = quote(c, 100 * Math.exp(b.imp), 'sell', 10);
    expect(s.total).toBeLessThan(b.total);
    expect(quote(c, 100, 'buy', 1e6).imp).toBe(MAX_TRADE_IMPACT);
  });
});

describe('trading (memory wallet)', () => {
  it('buys debit chips through the wallet, add holdings and push the price; sells credit back', async () => {
    const { e, adv } = mk(); const name = 'QA-Stocks1'; fund(name, 5000);
    const c = [...COMPANIES].sort((a, b) => a.start - b.start)[0]!; const p0 = e.price(c.ticker)!;
    const r = await e.trade(name, 'buy', c.ticker, 80);
    expect(getBank().account(name).chips).toBe(5000 - r.total);
    expect(e.price(c.ticker)!).toBeGreaterThan(p0);
    expect((await e.portfolio(name)).holdings[0]).toMatchObject({ ticker: c.ticker, shares: 80, cost: r.total });
    await expect(e.trade(name, 'sell', c.ticker, 81)).rejects.toThrow(/own 80/);
    adv(TICK_MS);
    const s = await e.trade(name, 'sell', c.ticker, 80);
    expect(getBank().account(name).chips).toBe(5000 - r.total + s.total);
    expect((await e.portfolio(name)).holdings).toHaveLength(0);
    const tx = (await getBank().recent(name, 10)).filter((t) => t.game === 'stocks'); expect(tx.length).toBe(2);
  });
  it('refuses buys without chips and orders above the per-trade cap', async () => {
    const { e } = mk(); const name = 'QA-Stocks2'; fund(name, 3);
    await expect(e.trade(name, 'buy', 'QRKL', 1)).rejects.toThrow(/Not enough chips/);
    fund(name, 10_000_000); const c = COMPANY_BY_TICKER.get('QRKL')!;
    await expect(e.trade(name, 'buy', 'QRKL', Math.ceil(maxOrderChips(c) / e.price('QRKL')!) + 50)).rejects.toThrow(/too large/);
    await expect(e.trade(name, 'buy', 'NOPE', 1)).rejects.toThrow(/Unknown/);
    await expect(e.trade(name, 'buy', 'QRKL', 1.5)).rejects.toThrow(/whole/);
  });
  it('ticks advance prices once per slot and apply due news once', async () => {
    const { e, adv } = mk(); adv(TICK_MS);
    expect(await e.tick()).toBe(true); expect(await e.tick()).toBe(false);
    const n = e.news.length; expect(n).toBeGreaterThan(50); // ~half the day's events are due at noon UTC
    adv(TICK_MS); await e.tick(); expect(e.news.filter((x) => x.at <= T0 - 3_600_000).length).toBeLessThanOrEqual(n);
    expect(new Set(e.news.map((x) => x.id)).size).toBe(e.news.length);
  });
  it('values player-owned stock as assets in the economy', () => {
    const v = valueHoldings({ skins: [], stacks: [], machines: [], stocks: [{ ticker: 'QRKL', n: 10, price: 12.5 }] }, new Map());
    expect(v.categories.find((x) => x.key === 'stocks')?.value).toBe(125); expect(v.estPct).toBe(0);
  });
});
