// Integration: run the v2 Postgres SQL paths against an in-process Postgres (PGlite).
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getBank } from '../server/casino-store';
import { Exchange } from '../server/stocks';
import { Derivatives } from '../server/derivs';
import { strikeFor } from '../shared/derivs';

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; };
  return {
    query: q,
    connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; },
  };
}

describe('stocks v2 on Postgres', () => {
  it('migrates and runs fund, short, option and daily flows', async () => {
    const db = new PGlite(); const pool = shim(db) as never;
    const clk = { now: Date.parse('2026-11-01T12:00:00Z') };
    const e = new Exchange(pool, () => clk.now); await e.init();
    const d = new Derivatives(e, pool, () => clk.now); await d.init(); await d.init();
    const n = 'QA-S2pg'; const b = getBank(); b.transfer(n, 20_000 - b.account(n).chips, { game: 'admin' });
    await d.tradeFund(n, 'buy', 'CH100', 5); await d.tradeFund(n, 'sell', 'CH100', 2);
    expect((await d.fundPositions(n))[0]!.units).toBe(3);
    const s = await d.openShort(n, 'QRKL', 3); expect((await d.shorts(n))).toHaveLength(1);
    clk.now += 60_000; const c = await d.closeShort(n, s.id); expect(c.payout).toBeGreaterThan(0);
    await expect(d.closeShort(n, s.id)).rejects.toThrow();
    const p = e.price('GLTC')!; await d.buyOption(n, 'GLTC', 'call', strikeFor(p, 0), 1, 2);
    await d.openShort(n, 'BYTZ', 2);
    expect(await d.liquidate()).toBe(0);
    clk.now = Date.parse('2026-11-02T16:10:00Z');
    expect(await d.expire()).toBe(1); expect(await d.expire()).toBe(0);
    expect(await d.daily()).not.toBeNull(); expect(await d.daily()).toBeNull();
    const port = await d.portfolio(n); expect(port.history.options[0]!.status).not.toBe('open');
    const a = await d.economyAssets(); expect(Array.isArray(a)).toBe(true);
    expect(b.account(n).chips).toBeGreaterThan(0);
  }, 30_000);
});
