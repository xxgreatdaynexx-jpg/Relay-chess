import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getAccounts, resetAccounts } from '../server/accounts.js';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { getBank, resetBank } from '../server/casino-store.js';
import { resetLeaderboard } from '../server/leaderboard.js';

const TOKEN = 'qa-admin-token-0123456789abcdef0123456789';

describe('admin reset-password', () => {
  let ctx: AppContext; let url = ''; let oldTok = ''; let otherTok = '';
  beforeAll(async () => {
    process.env.ADMIN_GRANT_TOKEN = TOKEN;
    resetAccounts(); resetBank();
    resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-reset-')), 'lb.json'));
    oldTok = (await getAccounts().claim('QA-Carter', 'secret1', 'ip')).token;
    otherTok = (await getAccounts().claim('QA-Other', 'secret2', 'ip')).token;
    ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(ctx.httpServer.address() as AddressInfo).port}/api/admin/reset-password`;
  });
  afterAll(async () => { delete process.env.ADMIN_GRANT_TOKEN; await closeApp(ctx); });
  const post = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });

  it('rejects bad auth and bad input', async () => {
    expect((await post({ player: 'qa-carter', key: 'reset:qa-carter:0' }, null)).status).toBe(401);
    expect((await post({ player: 'qa-carter', key: 'reset:qa-carter:0' }, 'Bearer nope')).status).toBe(401);
    expect((await post({ player: 'qa-carter' })).status).toBe(400);
    expect((await post({ player: 'QA-Nobody', key: 'reset:nobody:1' })).status).toBe(404);
  });
  it('resets once, revokes only that player\'s sessions, never logs the password, chips untouched', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.join(' ')); });
    const before = getBank().account('QA-Carter').chips;
    const res = await post({ player: 'qa-carter', memo: 'test', key: 'reset:qa-carter:1' });
    spy.mockRestore();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, player: 'QA-Carter', sessionsRevoked: 1 });
    expect(j.tempPassword.length).toBeGreaterThanOrEqual(20);
    expect(logs.some((l) => l.includes(j.tempPassword))).toBe(false);
    expect(await getAccounts().resume(oldTok)).toBeNull();
    expect(await getAccounts().resume(otherTok)).not.toBeNull();
    await expect(getAccounts().login('QA-Carter', 'secret1', 'ip2')).rejects.toThrow();
    expect((await getAccounts().login('QA-Carter', j.tempPassword, 'ip2')).identity.name).toBe('QA-Carter');
    expect((await getAccounts().login('QA-Other', 'secret2', 'ip2')).identity.name).toBe('QA-Other');
    expect(getBank().account('QA-Carter').chips).toBe(before);
    expect((await post({ player: 'qa-carter', key: 'reset:qa-carter:1' })).status).toBe(409);
  });
});
