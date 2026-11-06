import { describe, expect, it } from 'vitest';
import { getBank } from '../server/casino-store';
import { Exchange } from '../server/stocks';
import { Derivatives } from '../server/derivs';
import { COMPANIES, COMPANY_BY_TICKER, TICK_MS } from '../shared/stocks';
import { FUND_BY_ID, navOf } from '../shared/derivs';
import { epsOf, fundSeries, keyStats, periodSpec, priceStats, seriesChange } from '../shared/stockStats';

const T0 = Date.parse('2026-11-01T18:00:00Z');
const mk = () => { const clk = { now: T0 }; const e = new Exchange(null, () => clk.now); const d = new Derivatives(e, null, () => clk.now); e.postTick = (n) => d.afterTick(n); return { e, d, clk }; };

describe('MU #9 stock stats (display only)', () => {
  it('EPS is deterministic per company; P/E = price / EPS, none when EPS < 0', () => {
    for (const c of COMPANIES) expect(epsOf(c)).toBe(epsOf(c));
    const c = COMPANIES.find((x) => epsOf(x) > 0)!; const s = keyStats(c, 100, [], 0, T0);
    expect(s.pe).toBeCloseTo(100 / s.eps, 0); expect(s.cap).toBe(100 * c.shares);
    const neg = COMPANIES.find((x) => epsOf(x) < 0); if (neg) expect(keyStats(neg, 50, [], 0, T0).pe).toBeNull();
    expect(COMPANIES.filter((x) => x.sector !== 'crypto').every((x) => epsOf(x) > 0)).toBe(true);
  });
  it('periodSpec maps toggles and legacy ranges', () => {
    expect(periodSpec('1d')).toEqual(periodSpec('24h')); expect(periodSpec('1w')).toEqual(periodSpec('7d')); expect(periodSpec('1m')).toEqual(periodSpec('30d'));
    expect(periodSpec('junk')).toEqual(periodSpec('1d')); expect(periodSpec('all').ms).toBeGreaterThanOrEqual(periodSpec('1m').ms);
  });
  it('priceStats ranges include the live price; seriesChange', () => {
    const pts: Array<[number, number]> = [[T0 - 86_400_000 * 3, 80], [T0 - 3600_000 * 20, 100], [T0 - 3600_000, 120]];
    const s = priceStats(pts, 90, T0); expect(s.lo30).toBe(80); expect(s.hi30).toBe(120); expect(s.dayLo).toBe(90); expect(s.dayHi).toBe(120);
    expect(seriesChange([[0, 100], [1, 110]])).toEqual({ abs: 10, pct: 10 });
  });
  it('fundSeries uses the same navOf the fund trades at', () => {
    const f = FUND_BY_ID.get('CH100')!; const rows = f.weights.map(([t]) => ({ ticker: t, t: T0, price: COMPANY_BY_TICKER.get(t)!.start * 1.1 }));
    const pts = fundSeries('CH100', rows); expect(pts).toHaveLength(1); expect(pts[0]![1]).toBeCloseTo(navOf(f, (t) => COMPANY_BY_TICKER.get(t)!.start * 1.1), 9);
  });
  it('company() adds stats; charts never change prices', async () => {
    const { e, d, clk } = mk(); const n = 'QA-MU9'; const b = getBank(); b.transfer(n, 50_000 - b.account(n).chips, { game: 'admin' });
    await e.trade(n, 'buy', COMPANIES[0]!.ticker, 5);
    for (let i = 0; i < 45; i++) { clk.now += TICK_MS; await e.tick(); }
    const before = COMPANIES.map((c) => e.rows.get(c.ticker)!.base);
    const r = await e.company(COMPANIES[0]!.ticker, '1d', n) as { stats: { pe: number | null; volume: number }; chart: unknown[] };
    expect(r.stats.volume).toBeGreaterThanOrEqual(5); expect(r.chart.length).toBeGreaterThan(1);
    const fc = await d.fundChart('CH100', '1d'); expect(fc.chart.length).toBeGreaterThan(1);
    const pc = await d.portfolioChart(n, '1d'); expect(pc.chart.length).toBeGreaterThanOrEqual(2); expect(pc.chart.at(-1)![1]).toBe(pc.totals.all);
    expect(COMPANIES.map((c) => e.rows.get(c.ticker)!.base)).toEqual(before);
  });
});
