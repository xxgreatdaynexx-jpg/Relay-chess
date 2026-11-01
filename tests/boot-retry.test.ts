import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootAttach, bootStates, resetBootStates, setBootState } from '../server/boot-retry.js';
import { ItemVault, OFFLINE_MSG, RuleError, type ItemStore, type StoredItem } from '../server/skins.js';
import { Market, MARKET_OFFLINE_MSG } from '../server/market.js';
import { ArenaLedger, type ArenaStore } from '../server/arena-store.js';
import { ChessStatsLedger, type ChessStatsStore } from '../server/chess-stats.js';
import { Leaderboard, getLeaderboard, resetLeaderboard } from '../server/leaderboard.js';
import type { LeaderboardStore, StoredEntry } from '../server/leaderboard-store.js';
import { ChatLog, CHAT_OFFLINE_MSG, type ChatStore } from '../server/chat.js';
import { SolitroHall, SOLITRO_OFFLINE_MSG, type SolitroStore } from '../server/solitro.js';
import { RequestBoard, REQUESTS_OFFLINE_MSG } from '../server/requests.js';
import { ConquestHub, MemoryCqStore } from '../server/conquest.js';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { resetAccounts } from '../server/accounts.js';
import { resetBank } from '../server/casino-store.js';

const FAST = { delayMs: 1, retryMs: 5 };
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
/** Fails the first `n` loads like a cold Neon, records every write. */
function flaky<T>(n: number, rows: T[]) {
  let calls = 0;
  const writes: unknown[] = [];
  return { writes, get calls() { return calls; }, init: async () => { calls++; if (calls <= n) throw new Error('timeout exceeded when trying to connect'); }, loadAll: async () => rows };
}

beforeEach(() => resetBootStates());

describe('bootAttach', () => {
  it('retries with backoff, goes offline, keeps reconnecting in the background, then reports ok', async () => {
    let n = 0; let ok = 0;
    await bootAttach('t', async () => { n++; if (n < 7) throw new Error('down'); return true; }, { tries: 4, ...FAST, onOk: () => { ok++; } });
    expect(n).toBe(4);
    expect(bootStates().t).toBe('offline');
    await tick(120);
    expect(bootStates().t).toBe('ok');
    expect(ok).toBe(1);
    expect(n).toBe(7);
  });
});

describe('skins / inventory', () => {
  it('refuses equip, cases and grants while offline, writes nothing, then loads the real items', async () => {
    const real = new ItemVault();
    const seed = flaky(0, [] as StoredItem[]);
    let saved: StoredItem[] = [];
    await real.attach({ ...seed, write: async (items) => { saved = items.map((i) => ({ ...i })); } } as ItemStore);
    real.make('Dana', 'case', 'test:1', 'test'); await real.flush?.();
    const rows = saved.length ? saved : [...real.items.values()];
    expect(rows.length).toBe(1);

    const v = new ItemVault(); v.offline = true;
    const store = flaky(3, rows.map((r) => ({ ...r })));
    const writes: unknown[] = [];
    const s = { ...store, init: store.init, loadAll: store.loadAll, write: async (items: StoredItem[]) => { writes.push(items); } } as unknown as ItemStore;
    await bootAttach('skins', () => v.attach(s), { tries: 2, ...FAST });
    expect(v.offline).toBe(true);
    expect(() => v.equip('Dana', rows[0].id)).toThrow(OFFLINE_MSG);
    expect(() => v.openCase('Dana')).toThrow(RuleError);
    expect(() => v.make('Dana', 'case', 'test:2', 'test')).toThrow(OFFLINE_MSG);
    expect(() => v.inventory('Dana')).toThrow(OFFLINE_MSG);
    expect(v.dropForMatch('m1', [{ name: 'Dana', ms: 600_000, kills: 5, deaths: 0 }])).toEqual([]);
    expect(writes).toEqual([]);
    await tick(120);
    expect(v.offline).toBe(false);
    expect(bootStates().skins).toBe('ok');
    expect(v.items.get(rows[0].id)?.owner).toBe(rows[0].owner);
  });
});

describe('market', () => {
  it('refuses every market action while the market or the vault is offline', () => {
    const v = new ItemVault(); const m = new Market(v);
    v.offline = true;
    expect(() => m.guard()).toThrow(MARKET_OFFLINE_MSG);
    v.offline = false; m.offline = true;
    expect(() => m.guard()).toThrow(MARKET_OFFLINE_MSG);
    m.offline = false;
    expect(() => m.guard()).not.toThrow();
  });
});

describe('arena stats', () => {
  it('drops stat bumps while offline (never saving over real totals), then loads the real rows', async () => {
    const saves: unknown[] = [];
    const src = new ArenaLedger();
    await src.attach({ ...flaky(0, []), save: async (r) => { saves.push({ ...r }); } } as ArenaStore);
    src.kill('Dana', 1); src.kill('Dana', 2); await tick(5);
    const row = saves.at(-1) as never;

    const l = new ArenaLedger(); l.offline = true;
    const writes: unknown[] = [];
    const st = { ...flaky(2, [row]), save: async (r: unknown) => { writes.push(r); } };
    await bootAttach('arena', () => l.attach(st as unknown as ArenaStore), { tries: 1, ...FAST });
    l.kill('Dana', 9);
    expect(writes).toEqual([]);
    await tick(120);
    expect(l.offline).toBe(false);
    expect(l.standings(10).find((s) => s.name === 'Dana')?.kills).toBe(2);
  });
});

describe('chess stats', () => {
  it('records nothing while offline, then loads the real rows', async () => {
    const saves: unknown[] = [];
    const src = new ChessStatsLedger();
    await src.attach({ ...flaky(0, []), save: async (r) => { saves.push({ ...r }); } } as ChessStatsStore);
    src.record('Dana', 'blunder' as never); await tick(5);
    const row = saves.at(-1) as never;
    const l = new ChessStatsLedger(); l.offline = true;
    const writes: unknown[] = [];
    const st = { ...flaky(2, [row]), save: async (r: unknown) => { writes.push(r); } } as unknown as ChessStatsStore;
    await bootAttach('chess-stats', () => l.attach(st), { tries: 1, ...FAST });
    l.record('Dana', 'blunder' as never);
    expect(writes).toEqual([]);
    await tick(120);
    expect(l.offline).toBe(false);
    expect(l.statsFor('Dana')).toEqual(src.statsFor('Dana'));
  });
});

describe('leaderboard', () => {
  it('records no results while offline (no increments reach the DB), then loads the real standings', async () => {
    const incs: StoredEntry[] = [];
    let calls = 0;
    const store: LeaderboardStore = {
      init: async () => { calls++; if (calls <= 2) throw new Error('timeout'); },
      loadAll: async () => [{ key: 'dana', name: 'Dana', wins: 5, losses: 1, draws: 0 }],
      increment: async (e) => { incs.push(e); }, rename: async () => {}, close: async () => {},
    };
    const b = new Leaderboard(null); b.offline = true;
    await bootAttach('leaderboard', () => b.attachStore(store), { tries: 1, ...FAST });
    b.record({ winner: 'white', white: ['Dana'], black: ['Eve'] } as never);
    b.rememberName('Dana');
    expect(b.usingDatabase).toBe(false);
    expect(incs).toEqual([]);
    await tick(120);
    expect(b.offline).toBe(false);
    expect(b.usingDatabase).toBe(true);
    expect(b.standings().find((r) => r.name === 'Dana')?.wins).toBe(5);
  });
});

describe('chat', () => {
  it('refuses posts while offline, then loads real history', async () => {
    const msg = { id: 3, name: 'Dana', text: 'hi', at: 1 };
    const inserts: unknown[] = [];
    let calls = 0;
    const store = { init: async () => { calls++; if (calls <= 2) throw new Error('timeout'); }, recent: async () => [msg], insert: async (m: unknown) => { inserts.push(m); }, prune: async () => {} } as unknown as ChatStore;
    const log = new ChatLog(); log.offline = true;
    await bootAttach('chat', () => log.attach(store), { tries: 1, ...FAST });
    expect(log.post('Dana', 'hello')).toEqual({ ok: false, error: CHAT_OFFLINE_MSG });
    expect(inserts).toEqual([]);
    await tick(120);
    expect(log.offline).toBe(false);
    expect(log.size).toBe(1);
  });
});

describe('solitro', () => {
  it('refuses runs and boards while offline, then loads', async () => {
    const saves: unknown[] = [];
    let calls = 0;
    const store = { init: async () => { calls++; if (calls <= 2) throw new Error('timeout'); }, loadAll: async () => [], save: async (r: unknown) => { saves.push(r); } } as SolitroStore;
    const h = new SolitroHall(() => 1); h.offline = true;
    await bootAttach('solitro', () => h.attach(store), { tries: 1, ...FAST });
    expect(() => h.start('Dana')).toThrow(SOLITRO_OFFLINE_MSG);
    expect(() => h.state('Dana')).toThrow(SOLITRO_OFFLINE_MSG);
    expect(() => h.standings()).toThrow(SOLITRO_OFFLINE_MSG);
    expect(saves).toEqual([]);
    await tick(120);
    expect(h.offline).toBe(false);
    expect(() => h.state('Dana')).not.toThrow();
  });
});

describe('requests', () => {
  it('refuses submit/vote/status while offline, then loads', async () => {
    const queries: string[] = [];
    let up = false;
    const db = { query: async (sql: string) => { queries.push(sql); if (!up) throw new Error('timeout'); return { rows: sql.includes('FROM change_requests') ? [{ id: 4, title: 'T', details: 'd', category: 'feature', author: 'Dana', author_key: 'dana', status: 'open', created_at: 1, updated_at: 1 }] : [] }; } };
    const b = new RequestBoard(db); b.offline = true;
    expect(b.submit('Dana', { title: 'A request', details: 'details here', category: 'feature' })).toEqual({ ok: false, error: REQUESTS_OFFLINE_MSG });
    expect(b.vote(4, 'Dana')).toEqual({ ok: false, error: REQUESTS_OFFLINE_MSG });
    expect(b.setStatus(4, 'approved', undefined, undefined)).toMatchObject({ ok: false, code: 503 });
    expect(queries.filter((q) => /INSERT|DELETE|UPDATE/.test(q))).toEqual([]);
    up = true; await b.load();
    expect(b.offline).toBe(false);
    expect(b.list({}).map((r) => r.id)).toEqual([4]);
  });
});

describe('conquest', () => {
  it('only uses the store once its tables are loaded', async () => {
    const hub = new ConquestHub();
    const inner = new MemoryCqStore();
    let calls = 0;
    const st = Object.create(inner) as MemoryCqStore;
    st.init = async () => { calls++; if (calls === 1) throw new Error('timeout'); };
    hub.offline = true;
    await expect(hub.attach(st)).rejects.toThrow();
    expect((hub as unknown as { store: unknown }).store ?? null).toBeNull();
    expect(hub.offline).toBe(true);
    await hub.attach(st);
    expect(hub.offline).toBe(false);
    hub.stop();
  });
});

describe('/api/health and offline boards', () => {
  let ctx: AppContext; let base = '';
  beforeAll(async () => {
    resetAccounts(); resetBank();
    resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-boot-')), 'lb.json'));
    ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(ctx.httpServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => { getLeaderboard().offline = false; await closeApp(ctx); });
  it('lists subsystem states (informational) and serves 503 instead of an empty leaderboard', async () => {
    setBootState('skins', 'offline'); setBootState('arena', 'ok');
    const h = await (await fetch(base + '/api/health')).json();
    expect(h.subsystems).toMatchObject({ skins: 'offline', arena: 'ok' });
    getLeaderboard().offline = true;
    const r = await fetch(base + '/api/leaderboard');
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ ok: false, offline: true, rows: [] });
  });
});
