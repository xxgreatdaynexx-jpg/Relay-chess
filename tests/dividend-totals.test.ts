// #37 (Jay): total dividend earnings, read-only from the wallet ledger, on the Stocks portfolio and the public profile.
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Derivatives } from '../server/derivs';
import { buildPlayerProfile } from '../server/player-profile';

function shim(db: PGlite) {
  const queries: string[] = [];
  return { queries, query: async (sql: string, args?: unknown[]) => { queries.push(sql); const r = args?.length ? await db.query(sql, args) : (await db.exec(sql)).at(-1) ?? { rows: [] }; return { rows: r.rows as Record<string, unknown>[], rowCount: r.rows.length }; } };
}
async function ledger() {
  const pg = new PGlite(); const db = shim(pg);
  await pg.exec(`CREATE TABLE wallet_transactions (id SERIAL PRIMARY KEY, player_key TEXT NOT NULL, amount BIGINT NOT NULL, balance BIGINT NOT NULL DEFAULT 0, game TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    INSERT INTO wallet_transactions (player_key, amount, game, created_at) VALUES
      ('jay', 120, 'dividend', now() - interval '20 days'), ('jay', 30, 'dividend', now() - interval '2 days'), ('jay', 50, 'dividend', now() - interval '1 hour'),
      ('jay', 9999, 'poker', now()), ('bob', 77, 'dividend', now())`);
  return { pg, db };
}

describe('#37 dividend totals', () => {
  it('portfolio totals: lifetime, last 7 days, payout count, other games ignored', async () => {
    const { db } = await ledger();
    const d = new Derivatives(null as never, db as never);
    expect(await d.dividendTotals('Jay')).toEqual({ total: 200, last7: 80, days: 3 });
    expect(await d.dividendTotals('nobody')).toEqual({ total: 0, last7: 0, days: 0 });
    expect(db.queries.every((q) => /^\s*SELECT/i.test(q))).toBe(true);
  });
  it('without a database (or on error) reports zero instead of throwing', async () => {
    expect(await new Derivatives(null as never, null).dividendTotals('Jay')).toEqual({ total: 0, last7: 0, days: 0 });
    const broken = { query: async () => { throw new Error('down'); } };
    expect(await new Derivatives(null as never, broken as never).dividendTotals('Jay')).toEqual({ total: 0, last7: 0, days: 0 });
  });
  it('public profile shows the lifetime total from the ledger and never writes it', async () => {
    const { db } = await ledger();
    const p = await buildPlayerProfile('Jay', { db: () => db, account: async (k) => (k === 'jay' ? { name: 'Jay' } : null), online: () => ({ online: false }), now: () => Date.now() });
    expect(p?.dividends).toBe(200);
    expect(db.queries.some((q) => /(INSERT|UPDATE|DELETE)[^;]*wallet_transactions/i.test(q))).toBe(false);
  });
});
