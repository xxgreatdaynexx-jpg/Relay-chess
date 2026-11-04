// #31 (chessguy2): net worth charts. Hourly all-player snapshots (batched, deduped, chips/ledger untouched) + chart render.
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HOUR, NETWORTH_MIGRATION, snapshotAllNetWorth } from '../server/networth-snapshots';
import { NetWorthChart } from '../client/src/components/NetWorthChart';

function shim(db: PGlite) {
  const queries: string[] = [];
  return { queries, query: async (sql: string, args?: unknown[]) => { queries.push(sql); const r = args?.length ? await db.query(sql, args) : (await db.exec(sql)).at(-1) ?? { rows: [] }; return { rows: r.rows as Record<string, unknown>[] }; } };
}
async function seed(n: number) {
  const pg = new PGlite(); const db = shim(pg);
  await pg.exec(`CREATE TABLE casino_players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, chips BIGINT NOT NULL DEFAULT 1000);
    CREATE TABLE wallet_transactions (id SERIAL PRIMARY KEY, player_key TEXT, amount BIGINT, balance BIGINT, game TEXT)`);
  for (let i = 0; i < n; i++) await pg.query('INSERT INTO casino_players VALUES ($1,$2,$3)', [`p${String(i).padStart(3, '0')}`, `P${i}`, 1000 + i]);
  return { pg, db };
}
const T = Date.UTC(2026, 10, 4, 15, 20);

describe('#31 hourly net worth snapshots', () => {
  it('writes one row per player per hour in batches, using chips + assets', async () => {
    const { pg, db } = await seed(450);
    const n = await snapshotAllNetWorth({ db, now: T, assets: async (name) => (name === 'P1' ? 500 : 0) });
    expect(n).toBe(450);
    expect(db.queries.filter((q) => q.startsWith('INSERT INTO networth_history')).length).toBe(3); // 200+200+50
    const r = (await pg.query("SELECT t, net, chips FROM networth_history WHERE player_key='p001'")).rows;
    expect(r).toEqual([{ t: Math.floor(T / HOUR) * HOUR, net: 1501, chips: 1001 }]);
  });
  it('is deduped within the hour (incl. an on-open profile snapshot) and fills the next hour', async () => {
    const { pg, db } = await seed(3);
    await snapshotAllNetWorth({ db, now: T, assets: async () => 0 });
    await pg.query('INSERT INTO networth_history VALUES ($1,$2,$3,$4)', ['p000', T + 60_000, 9, 9]); // profile opened
    expect(await snapshotAllNetWorth({ db, now: T + 30 * 60_000, assets: async () => 0 })).toBe(0);
    expect(await snapshotAllNetWorth({ db, now: T + HOUR, assets: async () => 0 })).toBe(3);
    expect((await pg.query('SELECT 1 FROM networth_history')).rows.length).toBe(7);
  });
  it('a later snapshot does not count as covering an earlier hour (catch-up runs fill gaps)', async () => {
    const { pg, db } = await seed(1);
    for (const m of NETWORTH_MIGRATION) await pg.exec(m);
    await pg.query('INSERT INTO networth_history VALUES ($1,$2,$3,$4)', ['p000', T, 1, 1]);
    expect(await snapshotAllNetWorth({ db, now: T - 3 * HOUR, assets: async () => 0 })).toBe(1);
  });
  it('never writes chips or the ledger, and tolerates a failing asset lookup', async () => {
    const { pg, db } = await seed(2);
    await snapshotAllNetWorth({ db, now: T, assets: async (n) => { if (n === 'P0') throw new Error('x'); return 7; } });
    expect(db.queries.some((q) => /UPDATE|INSERT INTO (casino_players|wallet_transactions)|DELETE/i.test(q))).toBe(false);
    expect((await pg.query('SELECT 1 FROM wallet_transactions')).rows.length).toBe(0);
    expect((await pg.query("SELECT chips FROM casino_players WHERE player_key='p000'")).rows).toEqual([{ chips: 1000 }]);
    expect((await pg.query("SELECT net FROM networth_history WHERE player_key='p001'")).rows).toEqual([{ net: 1008 }]);
  });
});

describe('#31 NetWorthChart', () => {
  const now = T;
  it('shows the empty hint with no history', () => {
    expect(renderToStaticMarkup(createElement(NetWorthChart, { h: { points: [], chips: [] }, now, current: 100 }))).toContain('networth-chart-empty');
  });
  it('draws a net worth line plus the chips line and the change since the first point', () => {
    const h = { points: [{ t: now - 2 * HOUR, net: 1000 }, { t: now - HOUR, net: 1500 }], chips: [{ t: now - 2 * HOUR, chips: 800 }, { t: now - HOUR, chips: 900 }] };
    const html = renderToStaticMarkup(createElement(NetWorthChart, { h, now, current: 2000 }));
    expect(html).toContain('data-testid="networth-chart"');
    expect(html).toContain('▲ +1K');
    expect((html.match(/<path /g) ?? []).length).toBe(3); // fill, chips, net
  });
  it('shows a drop in red', () => {
    const html = renderToStaticMarkup(createElement(NetWorthChart, { h: { points: [{ t: now - HOUR, net: 5000 }], chips: [] }, now, current: 3000 }));
    expect(html).toContain('text-rose-300'); expect(html).toContain('▼ -2K');
  });
});
