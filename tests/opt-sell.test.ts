import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getBank } from '../server/casino-store';
import { Exchange } from '../server/stocks';
import { Derivatives } from '../server/derivs';
import { COMPANY_BY_TICKER } from '../shared/stocks';
import { optionBid, optionPremium, strikeFor } from '../shared/derivs';

const T0 = Date.parse('2026-11-01T12:00:00Z'); const DAY = 86_400_000;
const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };
const chips = (n: string) => getBank().account(n).chips;
const setPrice = (e: Exchange, t: string, p: number) => { const r = e.rows.get(t)!; r.base = p; r.imp = 0; };
const mk = (pool: never | null = null) => { const clk = { now: T0 }; const e = new Exchange(pool, () => clk.now); const d = new Derivatives(e, pool, () => clk.now); return { e, d, clk }; };

describe('sell options before expiry', () => {
  it('bid is always below the buy premium (no buy-then-sell arbitrage)', () => {
    for (const c of [...COMPANY_BY_TICKER.values()].slice(0, 30)) for (const kind of ['call', 'put'] as const) for (const off of [-0.1, 0, 0.1]) for (const d of [1, 3, 7]) {
      const K = strikeFor(100, off); for (const q of [1, 7, 1000]) expect(optionBid(c, kind, 100, K, d, q)).toBeLessThan(optionPremium(c, kind, 100, K, d, q));
    }
  });
  it('immediate round trip loses chips; partial sells keep the rest for expiry settlement', async () => {
    const { d, e, clk } = mk(); const n = 'QA-OptSell1'; fund(n, 10_000); const t = 'GLTC'; setPrice(e, t, 100);
    const b = await d.buyOption(n, t, 'call', 100, 3, 10);
    const s1 = await d.sellOption(n, b.id, 4); expect(s1.payout).toBeLessThan(b.premium * 0.4 + 1); expect(s1.left).toBe(6);
    expect(chips(n)).toBe(10_000 - b.premium + s1.payout);
    const held = (await d.options(n))[0]!; expect(held.qty).toBe(6); expect(held.premium).toBe(b.premium - Math.round(b.premium * 0.4));
    await expect(d.sellOption(n, b.id, 7)).rejects.toThrow(/hold 6/);
    clk.now += 3 * DAY + 1; setPrice(e, t, 110);
    await expect(d.sellOption(n, b.id, 1)).rejects.toThrow(/expired/);
    const before = chips(n); expect(await d.expire()).toBe(1); expect(chips(n) - before).toBe(60); expect(await d.expire()).toBe(0);
  });
  it('full sell closes the contract; refuses unowned, double sells and concurrent sells', async () => {
    const { d, e } = mk(); const n = 'QA-OptSell2'; fund(n, 10_000); fund('QA-OptSell3', 1000); setPrice(e, 'GLTC', 100);
    const b = await d.buyOption(n, 'GLTC', 'put', 100, 7, 20);
    await expect(d.sellOption('QA-OptSell3', b.id, 1)).rejects.toThrow(/don't hold/);
    const [a, c] = await Promise.allSettled([d.sellOption(n, b.id, 20), d.sellOption(n, b.id, 20)]);
    expect([a.status, c.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect((await d.options(n))).toHaveLength(0); await expect(d.sellOption(n, b.id, 1)).rejects.toThrow(/don't hold/);
    const h = (await d.portfolio(n)).history.options[0]!; expect(h.status).toBe('sold');
    expect(await d.expire(T0 + 8 * DAY)).toBe(0);
    const tx = (await getBank().recent(n, 10)).filter((x) => x.game === 'stocks'); expect(tx).toHaveLength(2);
  });
  it('works on Postgres: partial, full, stale-qty guard', async () => {
    const db = new PGlite();
    const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; };
    let chain = Promise.resolve();
    const pool = { query: q, connect: async () => { let rel!: () => void; const prev = chain; chain = new Promise<void>((r) => (rel = r)); await prev; return { query: q, release: rel }; } } as never;
    const { d, e, clk } = mk(pool); await e.init(); await d.init(); const n = 'QA-OptSellPg'; fund(n, 10_000);
    const p = e.price('GLTC')!; const b = await d.buyOption(n, 'GLTC', 'call', strikeFor(p, 0), 3, 10);
    const s1 = await d.sellOption(n, b.id, 3); expect(s1.left).toBe(7);
    expect((await d.options(n))[0]!.qty).toBe(7);
    const s2 = await d.sellOption(n, b.id, 7); expect(s2.left).toBe(0); expect(await d.options(n)).toHaveLength(0);
    expect(chips(n)).toBe(10_000 - b.premium + s1.payout + s2.payout);
    clk.now += 4 * DAY; expect(await d.expire()).toBe(0);
  }, 30_000);
});
