import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAccounts, resetAccounts } from '../server/accounts.js';
import { adminAuthorized } from '../server/admin.js';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { getBank, resetBank } from '../server/casino-store.js';
import { resetLeaderboard } from '../server/leaderboard.js';

const TOKEN = 'qa-admin-token-0123456789abcdef0123456789';

describe('admin grant', () => {
  let ctx: AppContext; let url = '';
  beforeAll(async () => {
    process.env.ADMIN_GRANT_TOKEN = TOKEN;
    resetAccounts(); resetBank();
    resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-admin-')), 'lb.json'));
    await getAccounts().claim('QA-Larry', 'secret1', 'ip');
    ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(ctx.httpServer.address() as AddressInfo).port}/api/admin/grant`;
  });
  afterAll(async () => { delete process.env.ADMIN_GRANT_TOKEN; await closeApp(ctx); });
  const post = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });
  const ok = { player: 'qa-larry', amount: 50, memo: 'admin_grant: test', key: 'admin_grant:qa-larry:1' };

  it('rejects missing, wrong and unset tokens', async () => {
    expect((await post(ok, null)).status).toBe(401);
    expect((await post(ok, 'Bearer nope')).status).toBe(401);
    expect(adminAuthorized(`Bearer ${TOKEN}`, "")).toBe(false);
    expect(adminAuthorized(`Bearer short`, 'short')).toBe(false);
    expect(adminAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(getBank().account('QA-Larry').chips).toBe(1000);
  });
  it('validates amount, key and player', async () => {
    for (const amount of [0, -5, 10001, 2.5, '50']) expect((await post({ ...ok, amount })).status).toBe(400);
    expect((await post({ ...ok, key: undefined })).status).toBe(400);
    expect((await post({ ...ok, player: 'QA-Nobody' })).status).toBe(404);
  });
  it('credits once through the bank, replays are no-ops', async () => {
    const pushes: number[] = [];
    const off = getBank().onChange((a) => { if (a.name === 'QA-Larry') pushes.push(a.chips); });
    const r1 = await (await post(ok)).json();
    expect(r1).toMatchObject({ ok: true, applied: true, player: 'QA-Larry', before: 1000, after: 1050 });
    const r2 = await (await post(ok)).json();
    expect(r2).toMatchObject({ ok: true, applied: false, before: 1050, after: 1050 });
    expect(pushes).toEqual([1050]);
    off();
  });
});
