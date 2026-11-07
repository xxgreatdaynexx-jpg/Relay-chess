/**
 * Truck logistics safety regressions (pg-mem, real store code): lost commit acknowledgements, failed saves, hired miners
 * at Frostbite/Magma, legacy Market listings, exact baseline farming XP, fence token + timer gating.
 */
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { dropDrainedTestDatabase } from './fixtures/drain-postgres-db';
import { newDb } from 'pg-mem';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { MinesWorld, PgMineStore, resetMines } from '../server/mines';
import { LocStore, setLocStore, isOutcomeUnknown } from '../server/locstock';
import { wireCaves } from './helpers/caveStock';
import { CasinoBank, PgCasinoStore, resetBank } from '../server/casino-store';
import { Employment } from '../server/employment';
import { FISH_MIGRATION } from '../server/fishing';
import { setPriceIndexForTest, priceIndex } from '../server/price-index';
import { PgItemStore, resetVault } from '../server/skins';
import { resetMarket } from '../server/market';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { resetFarmGuardForTest } from '../server/farmGuard';
import { cropById, cropProfit, farmPayout, farmPlots } from '../shared/farm';
import { ledgerXp, getSkills } from '../server/skills';
import { cityPolicyMul } from '../server/city-rates';
import { FishFleet } from '../server/fishFleet';
import { HOUR } from '../shared/employment';
const run = promisify(execFile);
const mem = () => { const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); return { db, pool: new Pool() }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mines exit: unknown commit outcome never duplicates or loses a haul', () => {
  class Flaky extends PgMineStore {
    mode: 'ok' | 'ackLost' | 'fail' = 'ok';
    override async save(...a: Parameters<PgMineStore['save']>) {
      if (this.mode === 'fail') { this.mode = 'ok'; throw new Error('connection refused'); }
      await super.save(...a);
      if (this.mode === 'ackLost') { this.mode = 'ok'; throw new Error('Connection terminated unexpectedly'); } // COMMIT landed, reply lost
    }
  }
  const trip = async (mode: Flaky['mode']) => {
    const { pool } = mem(); const st = new Flaky(pool as never); const w = new MinesWorld(); await w.attach(st); await wireCaves(w, pool);
    const m = w.join('a', 'QA-Carrier', 0, 'coral'); await w.ready('a'); // map pools: only the Coral Grotto banks into a separate pool (the Resort Warehouse)
    m.carried.set('ore:coal', { type: 'ore', id: 'coal', qty: 4 }); (w as unknown as { markCarried(k: string): void }).markCarried('qa-carrier'); await w.flush();
    m.x = 4; m.y = 7; st.mode = mode; w.exit('a'); await w.flush(); await sleep(100);
    const w2 = new MinesWorld(); await w2.attach(new PgMineStore(pool as never)); const ls2 = await wireCaves(w2, pool); w2.join('b', 'QA-Carrier', Date.now(), 'coral'); await w2.ready('b');
    const cave = (await pool.query("SELECT COALESCE(SUM(qty),0)::int n FROM loc_stock WHERE loc = 'resort'")).rows[0].n;
    return { memCarried: w.carried('a'), restartCarried: w2.carried('b'), cave, cave2: ls2.qty('QA-Carrier', 'resort', 'ore:coal'), banks: (await pool.query('SELECT count(*)::int n FROM mine_banks')).rows[0].n };
  };
  it('ack lost after COMMIT: the bank marker proves it committed -> cave stock once, haul NOT put back', async () => {
    const r = await trip('ackLost');
    expect(r.memCarried).toEqual([]); expect(r.cave).toBe(4); expect(r.cave2).toBe(4); expect(r.restartCarried).toEqual([]); expect(r.banks).toBe(1);
  });
  it('save failed (nothing committed): haul goes back to the carry, no cave stock, nothing lost after restart', async () => {
    const r = await trip('fail');
    expect(r.memCarried).toEqual([{ type: 'ore', id: 'coal', qty: 4 }]); expect(r.cave).toBe(0); expect(r.banks).toBe(0);
    expect(r.restartCarried).toEqual([{ type: 'ore', id: 'coal', qty: 4 }]);
  });
});

// Real PostgreSQL (pg-mem does not roll a failed transaction back): a disposable local database.
const PGURL = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
describe.skipIf(!PGURL)('LocStore (real PostgreSQL): lost acknowledgement / unknown outcome reconcile by the write marker', () => {
  const dbs: Array<() => Promise<void>> = [];
  afterAll(async () => { for (const f of dbs) await f(); });
  const setup = async () => {
    const u = new URL(PGURL!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local test DB only');
    const name = `lmsafe_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; const root = new pg.Client({ connectionString: PGURL }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
    u.pathname = `/${name}`; const pool = new pg.Pool({ connectionString: u.toString(), max: 3 });
    dbs.push(async () => { await dropDrainedTestDatabase(root, pool, name); });
    await pool.query('CREATE TABLE mark (id TEXT PRIMARY KEY)');
    const ctl = { lose: false, failBefore: false, markerDown: false };
    const wrap = {
      query: (s: string, a?: unknown[]) => (ctl.markerDown && /^SELECT 1 FROM mark/.test(s) ? Promise.reject(new Error('db unreachable')) : pool.query(s, a as never)),
      connect: async () => { const c = await pool.connect(); return { release: () => c.release(), query: async (s: string, a?: unknown[]) => {
        if (/^INSERT INTO mark/.test(s) && ctl.failBefore) { ctl.failBefore = false; throw new Error('server closed the connection'); } // dropped mid-transaction: never committed
        if (s === 'COMMIT' && ctl.lose) { await c.query(s); ctl.lose = false; throw new Error('Connection terminated unexpectedly'); }
        return c.query(s, a as never); } }; },
    };
    const ls = new LocStore(wrap as never); await ls.init(); setLocStore(ls);
    await ls.adjust('QA-L', [{ loc: 'resort', item: 'ore:gold', delta: 10 }]);
    let n = 0; const write = (opts: Record<string, unknown> = {}) => { const id = `m${++n}`; return { id, p: ls.adjust('QA-L', [{ loc: 'resort', item: 'ore:gold', delta: -3 }], [{ sql: 'INSERT INTO mark VALUES ($1)', args: [id] }], { marker: { sql: 'SELECT 1 FROM mark WHERE id = $1', args: [id] }, ...opts }) as Promise<void> }; };
    const db = async () => Number((await pool.query("SELECT qty FROM loc_stock WHERE loc = 'resort'")).rows[0].qty);
    return { ls, ctl, write, db };
  };
  it('commit landed, reply lost -> success, memory kept once, DB once', async () => {
    const s = await setup(); s.ctl.lose = true; await s.write().p;
    expect(s.ls.qty('QA-L', 'resort', 'ore:gold')).toBe(7); expect(await s.db()).toBe(7);
  });
  it('failed before commit -> rejected and memory reverted', async () => {
    const s = await setup(); s.ctl.failBefore = true; await expect(s.write().p).rejects.toThrow(/closed/);
    expect(s.ls.qty('QA-L', 'resort', 'ore:gold')).toBe(10); expect(await s.db()).toBe(10);
  });
  it('outcome unknown (marker unreachable): memory kept, settled later both ways', async () => {
    const s = await setup(); const late = vi.fn();
    s.ctl.lose = true; s.ctl.markerDown = true; const a = s.write({ onLate: late });
    const e = await a.p.catch((x) => x); expect(isOutcomeUnknown(e)).toBe(true); expect(s.ls.qty('QA-L', 'resort', 'ore:gold')).toBe(7);
    s.ctl.markerDown = false; await sleep(1500); expect(late).toHaveBeenCalledWith(true); expect(s.ls.qty('QA-L', 'resort', 'ore:gold')).toBe(7); expect(await s.db()).toBe(7);
    const late2 = vi.fn(); s.ctl.failBefore = true; s.ctl.markerDown = true; const b = s.write({ onLate: late2 });
    expect(isOutcomeUnknown(await b.p.catch((x) => x))).toBe(true); expect(s.ls.qty('QA-L', 'resort', 'ore:gold')).toBe(4); // provisional
    s.ctl.markerDown = false; await sleep(1500); expect(late2).toHaveBeenCalledWith(false); expect(s.ls.qty('QA-L', 'resort', 'ore:gold')).toBe(7); expect(await s.db()).toBe(7);
  }, 10_000);
});

describe('hired miners: ore lands in the city map warehouse (map pools)', () => {
  it('collect puts every city miner’s ore in the Chud City Warehouse, persisted', async () => {
    setPriceIndexForTest(1); const T0 = Date.parse('2026-11-01T12:00:00Z'); let now = T0;
    const { pool } = mem(); const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    await pool.query('CREATE TABLE players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)'); await pool.query(FISH_MIGRATION);
    await pool.query('INSERT INTO players VALUES ($1,$2,$3)', ['gus', 'Gus', new Date(T0 - 5 * 24 * HOUR).toISOString()]);
    const ls = new LocStore(pool as never); await ls.init(); setLocStore(ls); resetMines();
    await pool.query('CREATE TABLE IF NOT EXISTS mine_items (player_key TEXT NOT NULL, owner_name TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (player_key, item_type, item_id))');
    const e = new Employment(pool as never, () => bank, () => now); await e.init();
    bank.transfer('Gus', 10_000_000, { game: 'admin' }); await bank.flush();
    for (const j of ['miner:frost', 'miner:magma', 'miner:mine']) await e.hire('Gus', j);
    now = T0 + 2 * HOUR; await e.collect('Gus'); await ls.idle();
    // the city warehouse's ore IS the banked store (mine_items), exactly as before Millionaire; nothing per-location
    expect((await pool.query("SELECT count(*)::int n FROM loc_stock WHERE player_key = 'gus'")).rows[0].n).toBe(0);
    const banked = Number((await pool.query("SELECT COALESCE(SUM(qty),0)::int n FROM mine_items WHERE player_key = 'gus'")).rows[0].n);
    expect(banked).toBeGreaterThan(0);
    expect(ls.at('Gus', 'warehouse').reduce((a, x) => a + x.qty, 0)).toBe(banked); // same stock, seen as the warehouse
  });
});

describe('legacy Market listings keep their origin (the factory)', () => {
  it('load stamps origin=factory; cancelling returns the goods to the factory store (= the city warehouse stock under map pools)', async () => {
    resetBank(); const { pool } = mem();
    const vv = resetVault(); await vv.attach(new PgItemStore(pool as never)); await resetMarket(vv).load();
    const w = resetMines(); await w.attach(new PgMineStore(pool as never)); const ls = new LocStore(pool as never); await ls.init(); setLocStore(ls);
    await pool.query("INSERT INTO market_stack_listings (id, seller_key, seller_name, item_type, item_id, qty_left, qty_total, unit_price, sold, status, created_at, closed_at) VALUES ('old1','qa-old','QA-Old','ore','iron',4,4,10,0,'active',1,NULL)");
    const mm = resetMarket(vv); await mm.load();
    expect((await pool.query("SELECT origin FROM market_stack_listings WHERE id = 'old1'")).rows[0].origin).toBe('factory');
    mm.cancelStack('QA-Old', 'old1'); await w.flush();
    expect(w.stackQty('QA-Old', 'ore', 'iron')).toBe(4); expect(ls.qty('QA-Old', 'warehouse', 'ore:iron')).toBe(4); // one store, not two
    expect((await pool.query("SELECT status FROM market_stack_listings WHERE id = 'old1'")).rows[0].status).toBe('cancelled');
  });
});

describe('fence token and timers', () => {
  it('an inherited chud-inv-* PGAPPNAME is never reused: each process makes its own', async () => {
    const code = "import('./server/invFence.ts').then((m) => console.log(JSON.stringify([m.fenceToken(), process.env.PGAPPNAME])))";
    const { stdout } = await run('npx', ['tsx', '-e', code], { env: { ...process.env, PGAPPNAME: 'chud-inv-inherited' } });
    const [tok, env] = JSON.parse(stdout.trim().split('\n').at(-1)!); expect(tok).toMatch(/^chud-inv-mp-[0-9a-f-]{36}$/); expect(tok).not.toBe('chud-inv-inherited'); expect(env).toBe(tok);
  });
  it('with a database configured, inventory timers do nothing until the fence is held and boot is ready', async () => {
    const was = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none';
    try {
      const { invReady, invHealth } = await import('../server/invFence');
      expect(invReady()).toBe(false); expect(invHealth()).toMatchObject({ ok: false, fence: 'not held' });
      const f = new FishFleet(); const tick = vi.spyOn(f, 'tick').mockImplementation(() => undefined as never); f.start(5); await sleep(60); f.stop();
      expect(tick).not.toHaveBeenCalled();
    } finally { if (was === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = was; }
  });
});
