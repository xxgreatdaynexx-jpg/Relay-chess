import { describe, expect, it } from 'vitest';
import { getBank } from '../server/casino-store';
import { Exchange, activitySignal, dailyDrift, stepBase } from '../server/stocks';
import { COMPANIES, COMPANY_BY_TICKER, MAX_TRADE_IMPACT, SECTORS, TICK_MS, maxOrderChips, quote } from '../shared/stocks';
import { valueHoldings } from '../server/economy';
import { dailyEvents } from '../server/stock-news';
const SK = 'test-secret-0123456789abcdef';

const T0 = Date.parse('2026-10-31T20:00:00Z'); // 14:00 UTC-6 — market open
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
      const a = dailyEvents(c, '2026-10-31', SK); expect(a.length).toBeGreaterThanOrEqual(1); expect(dailyEvents(c, '2026-10-31', SK)).toEqual(a);
      for (const ev of a) { expect(ev.at).toBeGreaterThanOrEqual(Date.parse('2026-10-31T00:00:00Z')); expect(Math.abs(ev.move)).toBeLessThanOrEqual(c.vol * 2.5 + 1e-9); expect(ev.move > 0).toBe(ev.good); }
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

describe('stock market hours', () => {
  it('is open 12:00–22:00 UTC-6 and closed outside', async () => {
    const { isMarketOpen, MARKET_CLOSED_MSG } = await import('../shared/stocks');
    expect(isMarketOpen(Date.parse('2026-11-01T17:59:00Z'))).toBe(false); // 11:59 local
    expect(isMarketOpen(Date.parse('2026-11-01T18:00:00Z'))).toBe(true);  // 12:00 local
    expect(isMarketOpen(Date.parse('2026-11-01T03:59:00Z'))).toBe(true);  // 21:59 local
    expect(isMarketOpen(Date.parse('2026-11-01T04:00:00Z'))).toBe(false); // 22:00 local
  });
  it('freezes ticks when closed but still runs postTick; rejects trades', async () => {
    const { MARKET_CLOSED_MSG } = await import('../shared/stocks');
    let now = Date.parse('2026-11-01T06:00:00Z'); // 00:00 local — closed
    const e = new Exchange(null, () => now);
    let posts = 0; e.postTick = async () => { posts++; };
    fund('qa-hrs', 50_000);
    expect(await e.tick()).toBe(false); expect(posts).toBe(1);
    const p0 = e.price('QRKL');
    now += TICK_MS; expect(await e.tick()).toBe(false); expect(e.price('QRKL')).toBe(p0); expect(posts).toBe(2);
    await expect(e.trade('qa-hrs', 'buy', 'QRKL', 1)).rejects.toThrow(MARKET_CLOSED_MSG);
    now = Date.parse('2026-11-01T20:00:00Z'); // open
    expect(await e.tick()).toBe(true);
    await e.trade('qa-hrs', 'buy', 'QRKL', 1);
  });
  it('marketOpenElapsed skips closed overnight hours', async () => {
    const { marketOpenElapsed, MARKET_OPEN_HOUR, MARKET_CLOSE_HOUR } = await import('../shared/stocks');
    const open = Date.parse('2026-11-05T20:00:00Z'); // 14:00 local
    const close = Date.parse('2026-11-06T04:00:00Z'); // 22:00 local
    const nextOpen = Date.parse('2026-11-06T18:00:00Z'); // 12:00 next day
    const midday = Date.parse('2026-11-06T20:00:00Z'); // 14:00 next day
    expect(marketOpenElapsed(open, close)).toBe(close - open);
    expect(marketOpenElapsed(close, nextOpen)).toBe(0);
    expect(marketOpenElapsed(open, midday)).toBe((close - open) + (midday - nextOpen));
    expect(MARKET_OPEN_HOUR).toBe(12); expect(MARKET_CLOSE_HOUR).toBe(22);
  });
  it('marketChartPlotPts compresses closed gap so overnight is not a long flat x-span', async () => {
    const { marketChartPlotPts, marketOpenElapsed } = await import('../shared/stocks');
    // Session A: 21:00 local → close; then tip while closed at 08:00 local next day; then 13:00 open.
    const a = Date.parse('2026-11-05T03:00:00Z'); // 21:00 Nov 4 local? Wait Nov 5 03:00Z = Nov 4 21:00 local — use clear stamps
    const pClose = Date.parse('2026-11-06T03:50:00Z'); // 21:50 local Nov 5 — open
    const closedTip = Date.parse('2026-11-06T14:00:00Z'); // 08:00 local Nov 6 — closed
    const afterOpen = Date.parse('2026-11-06T19:00:00Z'); // 13:00 local — open
    const raw: Array<[number, number]> = [
      [pClose - 3_600_000, 100],
      [pClose, 110],
      [closedTip, 110], // frozen tip while closed (server pushes now)
      [afterOpen, 120],
    ];
    const wall = raw[raw.length - 1]![0] - raw[0]![0];
    const openMs = marketOpenElapsed(raw[0]![0], raw[raw.length - 1]![0]);
    expect(openMs).toBeLessThan(wall * 0.6); // overnight dominates wall clock
    const plot = marketChartPlotPts(raw);
    expect(plot.length).toBeGreaterThanOrEqual(3);
    const xSpan = plot[plot.length - 1]!.x - plot[0]!.x;
    expect(xSpan).toBe(openMs);
    // From last open sample to a tip while closed, x only advances through remaining open minutes to 22:00 — not the overnight.
    const atClose = plot.find((p) => p.t === pClose)!;
    const tip = plot.find((p) => p.t === closedTip)!;
    expect(tip.x - atClose.x).toBe(marketOpenElapsed(pClose, closedTip));
    expect(tip.x - atClose.x).toBeLessThan(15 * 60_000); // < 15m (to 22:00), not the 10h wall-clock gap
    // After the market reopens, x advances again with price action
    const reopen = plot.find((p) => p.t === afterOpen)!;
    expect(reopen.x).toBeGreaterThan(tip.x);
    expect(reopen.p).toBe(120);
    // Must not merely drop closed points and still use wall-clock x (that would keep a long bridge)
    const naiveDrop = raw.filter(([t]) => t !== closedTip);
    const naiveWallSpan = naiveDrop[naiveDrop.length - 1]![0] - naiveDrop[0]![0];
    expect(xSpan).toBeLessThan(naiveWallSpan * 0.75);
  });
});
