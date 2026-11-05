// Reversible soft-disable (abandoned accounts / alts) + 5,000 net-worth floor for tax payouts.
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getAccounts, resetAccounts, PgAccountStore, Accounts } from '../server/accounts.js';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { getBank, resetBank } from '../server/casino-store.js';
import { resetLeaderboard } from '../server/leaderboard.js';
import { isDisabledName, setDisabledKeys } from '../shared/disabled.js';
import { boardFor } from '../shared/qa.js';
import { planWealthTax, TAX_SHARE_MIN_NET_WORTH } from '../shared/wealthTax.js';

const TOKEN = 'qa-admin-token-0123456789abcdef0123456789';

describe('account disable: pure', () => {
  it('boards drop disabled names (case-insensitive), wealth-tax shares need net worth >= 5,000', () => {
    setDisabledKeys(['chessguy']);
    expect(boardFor([{ name: 'Chessguy' }, { name: 'chessguy2' }], false).map((r) => r.name)).toEqual(['chessguy2']);
    setDisabledKeys([]);
    expect(TAX_SHARE_MIN_NET_WORTH).toBe(5_000);
    const R = (name: string, netWorth: number) => ({ name, netWorth, chips: netWorth });
    const p = planWealthTax([R('a', 4_999), R('b', 5_000), R('c', 20_000), R('d', 40_000), R('e', 1_000_000)]);
    expect(p.shares.map((s) => s.name)).toEqual(['b', 'c', 'd']);
  });
});

describe('account disable: Postgres store', () => {
  it('migration adds the column; disable blocks login + kills sessions; enable restores; row kept', async () => {
    const db = new PGlite();
    const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [] }; return { rows: r.rows as Record<string, unknown>[] }; };
    const store = new PgAccountStore({ query: q } as never); await store.init(); await store.init(); // idempotent
    const a = new Accounts(store);
    const { token } = await a.claim('carter', 'secret1', 'ip');
    expect(await a.resume(token)).toMatchObject({ name: 'carter' });
    const r = await a.setDisabled('carter', true, 'abandoned');
    expect(r).toMatchObject({ name: 'carter', changed: true, sessionsRevoked: 1 });
    expect(isDisabledName('Carter')).toBe(true); expect(isDisabledName('carter2')).toBe(false);
    expect(await a.resume(token)).toBeNull();
    await expect(a.login('carter', 'secret1', 'ip2')).rejects.toThrow(/disabled/);
    expect((await store.get('carter'))?.disabledAt).toBeGreaterThan(0);
    setDisabledKeys([]); expect(await a.loadDisabled()).toBe(1); expect(isDisabledName('carter')).toBe(true);
    await a.setDisabled('carter', false);
    expect(isDisabledName('carter')).toBe(false);
    expect((await a.login('carter', 'secret1', 'ip3')).identity.name).toBe('carter');
    expect((await db.query('SELECT count(*)::int AS n FROM players')).rows[0]).toEqual({ n: 1 });
  });
});

describe('admin disable / enable endpoints', () => {
  let ctx: AppContext; let base = '';
  beforeAll(async () => {
    process.env.ADMIN_GRANT_TOKEN = TOKEN; resetAccounts(); resetBank(); setDisabledKeys([]);
    resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-dis-')), 'lb.json'));
    for (const n of ['A', 'C', 'Jay']) await getAccounts().claim(n, 'secret1', 'ip');
    ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(ctx.httpServer.address() as AddressInfo).port}/api/admin`;
  });
  afterAll(async () => { delete process.env.ADMIN_GRANT_TOKEN; setDisabledKeys([]); await closeApp(ctx); });
  const post = (p: string, body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
    fetch(`${base}/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });

  it('auth + validation; any unknown name means nothing changes', async () => {
    expect((await post('disable', { usernames: ['A'], reason: 'x' }, null)).status).toBe(401);
    expect((await post('disable', { usernames: ['A'] })).status).toBe(400);
    expect((await post('disable', { usernames: ['A', 'a'], reason: 'x' })).status).toBe(400);
    const r = await post('disable', { usernames: ['A', 'B'], reason: 'alts' });
    expect(r.status).toBe(404); expect((await r.json()).missing).toEqual(['b']);
    expect(isDisabledName('A')).toBe(false);
  });
  it('dry run changes nothing; disable / enable round-trip, chips untouched', async () => {
    const before = getBank().account('A').chips;
    const d = await (await post('disable', { usernames: ['A', 'C'], reason: 'alts', dryRun: true })).json();
    expect(d.dryRun).toBe(true); expect(isDisabledName('A')).toBe(false);
    const r = await (await post('disable', { usernames: ['A', 'C'], reason: 'Jay alts' })).json();
    expect(r.accounts.map((x: { player: string; changed: boolean }) => [x.player, x.changed])).toEqual([['A', true], ['C', true]]);
    expect(isDisabledName('a') && isDisabledName('c') && !isDisabledName('Jay')).toBe(true);
    await expect(getAccounts().login('A', 'secret1', 'ip9')).rejects.toThrow(/disabled/);
    const list = await (await fetch(`${base}/disabled`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    expect(list.keys).toEqual(['a', 'c']);
    await post('enable', { usernames: ['A', 'C'] });
    expect(isDisabledName('A')).toBe(false);
    expect(getBank().account('A').chips).toBe(before);
  });
});
