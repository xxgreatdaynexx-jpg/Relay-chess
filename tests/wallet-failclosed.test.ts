import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newDb } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAccounts, resetAccounts } from '../server/accounts.js';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { CasinoBank, PgCasinoStore, getBank, isChipEvent, resetBank, WALLET_UNAVAILABLE, type CasinoStore } from '../server/casino-store.js';
import { resetLeaderboard } from '../server/leaderboard.js';

function pgStore(): PgCasinoStore {
  const db = newDb({ noAstCoverageCheck: true });
  const { Pool } = db.adapters.createPg();
  return new PgCasinoStore(new Pool());
}
/** A store whose first `failures` init() calls time out, like a cold Neon on boot. */
function flaky(inner: CasinoStore, failures: number): CasinoStore & { calls: number } {
  const s = Object.create(inner) as CasinoStore & { calls: number };
  s.calls = 0;
  s.init = async () => { s.calls++; if (s.calls <= failures) throw new Error('timeout exceeded when trying to connect'); return inner.init(); };
  return s;
}

describe('chip DB boot retry', () => {
  it('retries with backoff until it connects, refusing chip actions meanwhile', async () => {
    const bank = new CasinoBank();
    const store = flaky(pgStore(), 3);
    const waits: number[] = [];
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    const p = bank.connectUntilReady(store, [10, 20, 40], async (ms) => { waits.push(ms); if (++n === 2) await gate; });
    await new Promise((r) => setTimeout(r, 20));
    expect(bank.status).toBe('connecting');
    expect(bank.ready).toBe(false);
    expect(() => bank.transfer('QA-A', 5, { game: 'admin' })).toThrow(WALLET_UNAVAILABLE);
    expect(() => bank.debit('QA-A', 5)).toThrow(WALLET_UNAVAILABLE);
    expect(() => bank.transferAtomic([{ name: 'QA-A', amount: -1, key: 'k1', game: 'market' }])).toThrow(WALLET_UNAVAILABLE);
    await expect(bank.refresh('QA-A')).rejects.toThrow(WALLET_UNAVAILABLE);
    expect(bank.standings()).toEqual([]);
    expect(bank.canAfford('QA-A', 1)).toBe(false);
    release();
    expect(await p).toBe(true);
    expect(store.calls).toBe(4);
    expect(waits).toEqual([10, 20, 40]);
    expect(bank.status).toBe('ok');
    expect(bank.transfer('QA-A', 5, { game: 'admin', key: 'g1' })).toBe(true);
    await bank.flush();
    expect(await bank.refresh('QA-A')).toBe(1005);
  });
  it('lists the chip-moving socket events', () => {
    for (const e of ['bj_bet', 'roulette_bet', 'vslots_spin', 'vp_deal', 'he_sit', 'mines_sell', 'fac_buy', 'sit', 'pay_bailout', 'wallet_sub']) expect(isChipEvent(e)).toBe(true);
    for (const e of ['move', 'chat_send', 'auth_login', 'fps_move', 'roulette_watch']) expect(isChipEvent(e)).toBe(false);
  });
});

describe('/api/health and fail-closed admin', () => {
  let ctx: AppContext; let base = '';
  const TOKEN = 'qa-admin-token-0123456789abcdef0123456789';
  beforeAll(async () => {
    process.env.ADMIN_GRANT_TOKEN = TOKEN;
    resetAccounts(); resetBank();
    resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-health-')), 'lb.json'));
    await getAccounts().claim('QA-Hal', 'secret1', 'ip');
    ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(ctx.httpServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => { delete process.env.ADMIN_GRANT_TOKEN; await closeApp(ctx); });
  const admin = (p: string, body: unknown) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });

  it('503 while the chip DB is down, refusing grants and debits; 200 once connected', async () => {
    const bank = getBank();
    bank.requireDb();
    let r = await fetch(base + '/api/health');
    expect(r.status).toBe(503);
    expect((await r.json()).chipDb).toBe('connecting');
    const g = await admin('/api/admin/grant', { player: 'QA-Hal', amount: 5, memo: 'QA grant', key: 'qa_grant:hal:1' });
    expect(g.status).toBe(503); expect((await g.json()).error).toBe(WALLET_UNAVAILABLE);
    const d = await admin('/api/admin/debit', { player: 'QA-Hal', amount: 5, memo: 'QA test', key: 'qa_debit:hal:1' });
    expect(d.status).toBe(503);
    expect(await bank.attach(pgStore())).toBe(true);
    r = await fetch(base + '/api/health');
    expect(r.status).toBe(200);
    expect((await r.json()).chipDb).toBe('ok');
  });
});
