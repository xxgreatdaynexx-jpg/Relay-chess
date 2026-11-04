import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Exchange } from '../server/stocks';
import { dailyEvents, loadNewsKey } from '../server/stock-news';
import * as shared from '../shared/stocks';
import { COMPANIES } from '../shared/stocks';

const DAYS = ['2026-11-03', '2026-11-04', '2026-11-05'];
const sched = (secret: string) => COMPANIES.flatMap((c) => DAYS.flatMap((d) => dailyEvents(c, d, secret))).map((e) => [e.id, e.at, e.move]);
const shim = (db: PGlite) => { const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; }; return { query: q, connect: async () => ({ query: q, release: () => {} }) }; };
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe('stock news is keyed by a server secret', () => {
  it('the schedule is stable with the same secret and different with any other', () => {
    const a = sched('server-secret-aaaaaaaaaaaaaaaa');
    expect(sched('server-secret-aaaaaaaaaaaaaaaa')).toEqual(a);
    const b = sched('server-secret-bbbbbbbbbbbbbbbb');
    const same = a.filter((x, i) => x[1] === b[i]?.[1]).length;
    expect(same).toBeLessThan(a.length * 0.05);
    expect(() => dailyEvents(COMPANIES[0]!, DAYS[0]!, '')).toThrow();
  });
  it('the schedule is no longer exported from shared/ nor imported by the client', () => {
    expect('dailyEvents' in shared).toBe(false);
    for (const f of walk('client/src').filter((p) => /\.(ts|tsx)$/.test(p))) expect(readFileSync(f, 'utf8')).not.toMatch(/stock-news|dailyEvents/);
  });
  it('company payload has no upcoming count and no future news', async () => {
    let now = Date.parse('2026-11-03T12:00:00Z'); const e = new Exchange(null, () => now);
    for (let i = 0; i < 6; i++) { await e.tick(); now += 30_000; }
    for (const c of COMPANIES.slice(0, 20)) {
      const p = await e.company(c.ticker, '1d', null) as Record<string, unknown> & { news: Array<{ at: number }> };
      expect('upcoming' in p).toBe(false);
      for (const n of p.news) expect(n.at).toBeLessThanOrEqual(now);
      expect(JSON.stringify(p)).not.toMatch(/upcoming/);
    }
    const ov = e.list() as unknown as { news: Array<{ at: number }> };
    for (const n of ov.news) expect(n.at).toBeLessThanOrEqual(now);
  });
  it('DB key is generated once, survives restarts, and env overrides it; old history before the cutover is not re-published', async () => {
    const db = new PGlite(); const pool = shim(db) as never;
    const k1 = await loadNewsKey(pool, 1000, undefined); const k2 = await loadNewsKey(pool, 9999, undefined);
    expect(k1.secret).toHaveLength(64); expect(k2).toEqual(k1);
    const k3 = await loadNewsKey(pool, 5, 'env-secret-0123456789abcdef'); expect(k3.secret).toBe('env-secret-0123456789abcdef'); expect(k3.since).toBe(1000);
    const db2 = new PGlite(); const pool2 = shim(db2) as never;
    let now = Date.parse('2026-11-03T23:59:00Z'); const e = new Exchange(pool2, () => now); await e.init();
    await e.tick();
    expect(e.news.filter((n) => n.at <= now - 60_000)).toHaveLength(0); // nothing from before the cutover gets back-filled
  });
});
