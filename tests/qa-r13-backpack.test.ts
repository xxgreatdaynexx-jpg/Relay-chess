import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newDb } from 'pg-mem';
import { MinesWorld, PgMineStore, type MineStore } from '../server/mines';

const setup = () => { const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); return new Pool(); };
const give = (w: MinesWorld, id: string, ore: string, qty: number) => {
  const m = w.miners.get(id)!; const k = `ore:${ore}`; const c = m.carried.get(k);
  if (c) c.qty += qty; else m.carried.set(k, { type: 'ore', id: ore as 'coal', qty });
  (w as unknown as { markCarried(k: string): void }).markCarried(m.account!.toLowerCase());
};
const row = async (pool: ReturnType<typeof setup>, key: string) => (await pool.query('SELECT items FROM mine_carried WHERE player_key = $1', [key])).rows[0]?.items ?? null;

describe('QA r13: mining backpacks survive deploys and restarts', () => {
  it('zero-downtime deploy: the new instance boots while the old one is still mining; the player gets the LATEST haul, not the boot snapshot', async () => {
    const pool = setup();
    const old = new MinesWorld(); await old.attach(new PgMineStore(pool));
    old.join('a', 'QA-Deploy', 0); await old.ready('a'); give(old, 'a', 'coal', 5); await old.flush();
    const next = new MinesWorld(); await next.attach(new PgMineStore(pool)); // boots now
    give(old, 'a', 'gold', 4); await old.flush(); // keeps mining on the old instance
    old.closing = true; await old.flush(); // SIGTERM save
    next.join('b', 'QA-Deploy', Date.now()); await next.ready('b');
    expect(next.carried('b')).toEqual([{ type: 'ore', id: 'coal', qty: 5 }, { type: 'ore', id: 'gold', qty: 4 }]);
  });
  it('a player who started mining AFTER the new instance booted still gets the haul (was: empty, then the empty pack overwrote the row)', async () => {
    const pool = setup();
    const next = new MinesWorld(); await next.attach(new PgMineStore(pool));
    const old = new MinesWorld(); await old.attach(new PgMineStore(pool));
    old.join('a', 'QA-Late', 0); await old.ready('a'); give(old, 'a', 'iron', 7); await old.flush();
    next.join('b', 'QA-Late', Date.now()); await next.ready('b');
    expect(next.carried('b')).toEqual([{ type: 'ore', id: 'iron', qty: 7 }]);
  });
  it('SIGTERM flush writes every online haul (even with no pending debounce) and refuses new hits', async () => {
    const pool = setup();
    const w = new MinesWorld(); await w.attach(new PgMineStore(pool));
    w.join('a', 'QA-Term', 0); await w.ready('a');
    w.miners.get('a')!.carried.set('ore:silver', { type: 'ore', id: 'silver', qty: 2 }); // no timer queued
    w.closing = true; await w.flush();
    expect(await row(pool, 'qa-term')).toEqual([{ type: 'ore', id: 'silver', qty: 2 }]);
    expect(() => w.hit('a', 0, Date.now())).toThrow(/restarting/);
  });
  it('a dropped haul is saved right away and still there after a restart hours later', async () => {
    const pool = setup();
    const w = new MinesWorld(); await w.attach(new PgMineStore(pool));
    w.join('a', 'QA-Away', 0); await w.ready('a'); w.miners.get('a')!.carried.set('ore:coal', { type: 'ore', id: 'coal', qty: 9 });
    w.leave('a', 0); await w.flush();
    expect(await row(pool, 'qa-away')).toEqual([{ type: 'ore', id: 'coal', qty: 9 }]);
    w.join('x', 'QA-Other', 99_000_000); w.leave('x', 99_000_000); await w.flush();
    const w2 = new MinesWorld(); await w2.attach(new PgMineStore(pool));
    w2.join('b', 'QA-Away', Date.now() + 86_400_000); await w2.ready('b');
    expect(w2.carried('b')).toEqual([{ type: 'ore', id: 'coal', qty: 9 }]);
  });
  it('if the saved haul cannot be read, mining is refused and leaving never deletes the row', async () => {
    const pool = setup(); const real = new PgMineStore(pool);
    const w0 = new MinesWorld(); await w0.attach(real); w0.join('a', 'QA-Flaky', 0); await w0.ready('a'); give(w0, 'a', 'gem', 3); await w0.flush();
    const flaky: MineStore = Object.assign(Object.create(real) as PgMineStore, { loadCarried: async () => { throw new Error('db down'); } });
    const w = new MinesWorld(); await w.attach(flaky);
    w.join('b', 'QA-Flaky', 0);
    await expect(w.ready('b')).rejects.toThrow(/Could not load your backpack/);
    expect(() => w.hit('b', 0, Date.now())).toThrow(/Loading your backpack/);
    w.leave('b'); await w.flush();
    expect(await row(pool, 'qa-flaky')).toEqual([{ type: 'ore', id: 'gem', qty: 3 }]);
  }, 10_000);
  it('the deploy actually delivers SIGTERM to node, and shutdown saves backpacks first with a per-step timeout', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: { start: string } };
    expect(pkg.scripts.start).toMatch(/\bexec node dist\/server\/index\.js$/); // without exec, sh swallowed SIGTERM and node was SIGKILLed unsaved
    const idx = readFileSync('server/index.ts', 'utf8');
    const body = idx.slice(idx.indexOf('async function shutdown'));
    expect(body.indexOf('getMines().closing = true')).toBeGreaterThan(0);
    expect(body.indexOf("step('mines'")).toBeLessThan(body.indexOf("step('rooms'"));
    expect(idx).toMatch(/SHUTDOWN_STEP_MS = \d/);
    expect(idx).toMatch(/process\.on\('SIGTERM'/); expect(idx).toMatch(/process\.on\('SIGINT'/);
  });
  it('signing in after joining as a guest rejoins as the account so the saved haul loads', () => {
    const src = readFileSync('server/mines.ts', 'utf8');
    expect(src).toMatch(/if \(m && !m\.account && account\(\)\)/);
    expect(src).toMatch(/await m\.restoring/);
  });
});

describe('QA r13: Stock Exchange polish', () => {
  it('order lock holds at least 500 ms, and the stock trade keeps it until the refreshed holding is loaded (no stale "You own")', async () => {
    const { MIN_BUSY_MS } = await import('../client/src/lib/moneyAction');
    expect(MIN_BUSY_MS).toBeGreaterThanOrEqual(500);
    const s = readFileSync('client/src/components/StocksPage.tsx', 'utf8');
    expect(s).toMatch(/if \(a\.ok && !a\.replayed\) await load\(\)/);
    expect(s).toMatch(/seq === loadSeq\.current/);
    expect(s.match(/aria-busy=\{busy === /g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});
