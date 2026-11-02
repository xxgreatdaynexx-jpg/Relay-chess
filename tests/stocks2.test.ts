import { describe, expect, it } from 'vitest';
import { getBank } from '../server/casino-store';
import { Exchange } from '../server/stocks';
import { Derivatives } from '../server/derivs';
import { COMPANY_BY_TICKER, TICK_MS } from '../shared/stocks';
import { DIV_YIELD, FUNDS, FUND_BY_ID, SHORT_INIT, navOf, needsLiquidation, optionPayout, optionValue, shortEquity, strikeFor } from '../shared/derivs';
import { valueHoldings } from '../server/economy';

const T0 = Date.parse('2026-11-01T12:00:00Z');
const mk = () => { const clk = { now: T0 }; const e = new Exchange(null, () => clk.now); const d = new Derivatives(e, null, () => clk.now); return { e, d, clk }; };
const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };
const chips = (n: string) => getBank().account(n).chips;
const setPrice = (e: Exchange, t: string, p: number) => { const r = e.rows.get(t)!; r.base = p; r.imp = 0; };

describe('v2 defaults', () => {
  it('pays dividends only in some sectors, 0.05-0.2%/day base x DIV_MULT', () => {
    const payers = [...DIV_YIELD].filter(([, y]) => y > 0);
    expect(payers.length).toBeGreaterThan(20);
    for (const [t, y] of payers) { expect(y).toBeGreaterThanOrEqual(0.0005 * 30 - 1e-12); expect(y).toBeLessThanOrEqual(0.002 * 30 + 1e-12); expect(['realestate', 'finance', 'energy', 'food', 'industrials', 'retail', 'healthcare', 'defense']).toContain(COMPANY_BY_TICKER.get(t)!.sector); }
    for (const c of COMPANY_BY_TICKER.values()) if (c.sector === 'crypto' || c.sector === 'tech') expect(DIV_YIELD.get(c.ticker)).toBe(0);
  });
  it('funds: weights sum to 1, NAV starts at 100', () => {
    for (const f of FUNDS) { expect(f.weights.reduce((a, [, w]) => a + w, 0)).toBeCloseTo(1, 9); for (const [t] of f.weights) expect(COMPANY_BY_TICKER.has(t)).toBe(true); expect(navOf(f, () => null)).toBeCloseTo(100, 6); }
    expect(FUNDS.filter((f) => f.kind === 'index').every((f) => f.fee === 0.0025 && f.expense === 0)).toBe(true);
  });
  it('option model: call value rises with price and vol, payout capped at intrinsic', () => {
    expect(optionValue('call', 110, 100, 0.03, 3)).toBeGreaterThan(optionValue('call', 100, 100, 0.03, 3));
    expect(optionValue('call', 100, 100, 0.06, 3)).toBeGreaterThan(optionValue('call', 100, 100, 0.03, 3));
    expect(optionValue('put', 90, 100, 0.03, 0)).toBe(10);
    expect(optionPayout('call', 120, 100, 5)).toBe(100); expect(optionPayout('call', 90, 100, 5)).toBe(0); expect(optionPayout('put', 90, 100, 5)).toBe(50);
  });
});

describe('funds', () => {
  it('buys and sells units through the wallet with the lower index fee', async () => {
    const { d } = mk(); const n = 'QA-S2fund'; fund(n, 5000);
    const r = await d.tradeFund(n, 'buy', 'CH100', 10);
    expect(r.fee).toBe(Math.max(1, Math.ceil(r.gross * 0.0025))); expect(chips(n)).toBe(5000 - r.total);
    const p = await d.portfolio(n); expect(p.funds[0]).toMatchObject({ fund: 'CH100', units: 10 }); expect(p.totals.funds).toBeGreaterThan(900);
    await expect(d.tradeFund(n, 'sell', 'CH100', 11)).rejects.toThrow(/own 10/);
    const s = await d.tradeFund(n, 'sell', 'CH100', 10); expect(chips(n)).toBe(5000 - r.total + s.total);
    expect((await d.portfolio(n)).funds).toHaveLength(0);
  });
  it('fund trades do not move constituent prices', async () => {
    const { d, e } = mk(); const n = 'QA-S2fund2'; fund(n, 50_000); const before = e.price('QRKL');
    await d.tradeFund(n, 'buy', 'CHTEK', 100); expect(e.price('QRKL')).toBe(before);
  });
});

describe('shorts', () => {
  it('locks 150% collateral, closes with P&L settled atomically', async () => {
    const { d, e, clk } = mk(); const n = 'QA-S2short'; fund(n, 10_000); const t = 'QRKL'; setPrice(e, t, 50);
    const o = await d.openShort(n, t, 10);
    expect(o.collateral).toBe(Math.ceil(SHORT_INIT * Math.floor(o.fill * 10)));
    expect(chips(n)).toBe(10_000 - o.collateral - o.fee);
    expect(e.price(t)!).toBeLessThan(50); // a short sale pushes the price down like a sell
    clk.now += TICK_MS; setPrice(e, t, 40);
    const c = await d.closeShort(n, o.id);
    expect(c.payout).toBeGreaterThan(o.collateral); // price fell: profit
    expect(chips(n)).toBe(10_000 - o.collateral - o.fee + c.payout);
    await expect(d.closeShort(n, o.id)).rejects.toThrow(/already closed/);
    const tx = (await getBank().recent(n, 10)).filter((x) => x.game === 'stocks'); expect(tx.length).toBe(2);
  });
  it('liquidates under maintenance and never pays below 0 even on a huge gap', async () => {
    const { d, e } = mk(); const n = 'QA-S2liq'; fund(n, 10_000); const t = 'BYTZ'; setPrice(e, t, 20);
    const o = await d.openShort(n, t, 20); const after = chips(n);
    setPrice(e, t, 21); expect(await d.liquidate()).toBe(0);
    setPrice(e, t, 500); // 25x gap: equity is deeply negative
    expect(await d.liquidate()).toBe(1); expect(await d.liquidate()).toBe(0);
    expect(chips(n)).toBe(after); expect(chips(n)).toBeGreaterThanOrEqual(0);
    const h = (await d.portfolio(n)).history.shorts[0]!; expect(h).toMatchObject({ id: o.id, status: 'liquidated', payout: 0 });
  });
  it('liquidation at the threshold returns the remaining equity', async () => {
    const { d, e } = mk(); const n = 'QA-S2liq2'; fund(n, 10_000); const t = 'PIXF'; setPrice(e, t, 30);
    const o = await d.openShort(n, t, 10); const s = (await d.shorts(n))[0]!; const after = chips(n);
    let p = 30; while (!needsLiquidation(s, p)) p += 0.05; setPrice(e, t, p);
    await d.liquidate(); const paid = chips(n) - after;
    expect(paid).toBeGreaterThan(0); expect(paid).toBeLessThanOrEqual(Math.floor(shortEquity(s, e.price(t)!))); expect(o.id).toBe(s.id);
  });
  it('refuses a short you cannot collateralise', async () => {
    const { d, e } = mk(); const n = 'QA-S2poor'; fund(n, 100); setPrice(e, 'QRKL', 50);
    await expect(d.openShort(n, 'QRKL', 10)).rejects.toThrow(/Not enough chips/); expect(chips(n)).toBe(100);
  });
});

describe('options', () => {
  it('premium is paid up front, settles once at expiry, max loss is the premium', async () => {
    const { d, e, clk } = mk(); const n = 'QA-S2opt'; fund(n, 10_000); const t = 'GLTC'; setPrice(e, t, 100);
    const call = await d.buyOption(n, t, 'call', strikeFor(100, 0), 1, 10);
    const put = await d.buyOption(n, t, 'put', strikeFor(100, -0.05), 1, 10);
    expect(chips(n)).toBe(10_000 - call.premium - put.premium);
    const p = await d.portfolio(n); expect(p.options).toHaveLength(2); expect(p.totals.options).toBeGreaterThan(0);
    clk.now += 86_400_000 / 2; expect(await d.expire()).toBe(0);
    clk.now += 86_400_000 / 2 + 1; setPrice(e, t, 112);
    expect(await d.expire()).toBe(2); expect(await d.expire()).toBe(0);
    expect(chips(n)).toBe(10_000 - call.premium - put.premium + 120);
    const h = (await d.portfolio(n)).history.options; expect(h.find((x) => x.kind === 'put')?.payout).toBe(0);
  });
  it('validates strike, expiry and size', () => {
    const { d, e } = mk(); setPrice(e, 'GLTC', 100);
    expect(() => d.optionQuote('GLTC', 'call', 200, 1, 1)).toThrow(/25%/);
    expect(() => d.optionQuote('GLTC', 'call', 100, 2, 1)).toThrow(/Expiry/);
    expect(() => d.optionQuote('GLTC', 'call', 100, 1, 0)).toThrow(/Cover/);
    expect(() => d.optionQuote('GLTC', 'straddle', 100, 1, 1)).toThrow(/call or a put/);
  });
});

describe('daily payout', () => {
  it('pays dividends exactly once per UTC day after 16:00, incl. fund pass-through; expenses and borrow fees burn', async () => {
    const { d, e, clk } = mk(); const n = 'qa-s2div'; fund(n, 100_000);
    const payer = [...DIV_YIELD].find(([, y]) => y >= 0.001)![0]; setPrice(e, payer, 100);
    await e.trade(n, "buy", payer, 5);
    await d.tradeFund(n, 'buy', 'DIVI', 20);
    setPrice(e, 'QRKL', 50); clk.now += TICK_MS; const s = await d.openShort(n, 'QRKL', 10);
    const before = chips(n);
    expect(await d.daily()).toBeNull(); // 12:00 UTC: not yet
    clk.now = Date.parse('2026-11-01T16:00:05Z');
    const info = await d.daily(); expect(info).not.toBeNull();
    const stockDiv = 5 * e.price(payer)! * DIV_YIELD.get(payer)!;
    expect(chips(n) - before).toBeGreaterThanOrEqual(Math.floor(stockDiv)); expect(chips(n) - before).toBe(info!.paid);
    expect(await d.daily()).toBeNull(); clk.now += 3_600_000; expect(await d.daily()).toBeNull(); expect(chips(n) - before).toBe(info!.paid);
    const p = await d.portfolio(n);
    expect(p.funds[0]!.units).toBeCloseTo(20 * (1 - FUND_BY_ID.get('DIVI')!.expense), 9);
    expect(p.shorts[0]!.collateral).toBeLessThan(s.collateral);
    const tx = (await getBank().recent(n, 20)).filter((x) => x.game === 'dividend'); expect(tx.length).toBe(1);
    clk.now = Date.parse('2026-11-02T16:30:00Z'); expect(await d.daily()).not.toBeNull();
  });
  it('afterTick runs all jobs once (exchange postTick hook)', async () => {
    const { d, e, clk } = mk(); e.postTick = (now) => d.afterTick(now); let calls = 0; const orig = d.daily.bind(d); d.daily = async (t?: number) => { calls++; return orig(t); };
    clk.now = Date.parse('2026-11-01T17:00:00Z'); expect(await e.tick()).toBe(true); expect(await e.tick()).toBe(false); expect(calls).toBe(1);
  });
});

describe('bank valuation', () => {
  it('counts funds, short equity and options as assets', () => {
    const v = valueHoldings({ skins: [], stacks: [], machines: [], extra: [{ key: 'funds', label: 'Funds', value: 500 }, { key: 'shorts', label: 'Short equity', value: 300 }, { key: 'options', label: 'Options', value: 0 }] }, new Map());
    expect(v.total).toBe(800); expect(v.categories.map((c) => c.key).sort()).toEqual(['funds', 'shorts']);
  });
  it('economyAssets excludes QA accounts', async () => {
    const { d } = mk(); fund('QA-S2econ', 5000); await d.tradeFund('QA-S2econ', 'buy', 'CH100', 5);
    fund('RealS2Player', 5000); await d.tradeFund('RealS2Player', 'buy', 'CH100', 5);
    const a = await d.economyAssets(); const f = a.find((x) => x.key === 'funds')!.value; expect(f).toBeGreaterThan(400); expect(f).toBeLessThan(600);
  });
});
