import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAccounts, resetAccounts } from '../server/accounts.js';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { resetBank } from '../server/casino-store.js';
import { resetLeaderboard } from '../server/leaderboard.js';
import { validName } from '../server/player-profile.js';

describe('public player profile', () => {
  let ctx: AppContext; let base = '';
  beforeAll(async () => {
    resetAccounts(); resetBank();
    resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-prof-')), 'lb.json'));
    await getAccounts().claim('Prof Tester', 'secret1', 'ip');
    await getAccounts().claim('QA-Hidden', 'secret1', 'ip');
    ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(ctx.httpServer.address() as AddressInfo).port}/api/player/`;
  });
  afterAll(async () => { await closeApp(ctx); });

  it('returns assets for a real account and never private fields', async () => {
    const r = await fetch(base + encodeURIComponent('prof tester'));
    expect(r.status).toBe(200);
    const { profile } = await r.json();
    expect(profile.name).toBe('Prof Tester');
    expect(profile.online).toBe(false);
    for (const k of ['properties', 'farms', 'cars', 'stocks', 'funds', 'options', 'shorts']) expect(Array.isArray(profile[k])).toBe(true);
    expect(profile.netWorth).toBe((profile.chips ?? 0) + profile.assets);
    const text = JSON.stringify(profile).toLowerCase();
    for (const bad of ['password', 'hash', 'email', 'token', 'session']) expect(text).not.toContain(bad);
  });
  it('404s unknown players without creating them, hides QA from the public, rejects bad names', async () => {
    expect((await fetch(base + 'Nobody-Here')).status).toBe(404);
    expect(await getAccounts().store.get('nobody-here')).toBeNull();
    expect((await fetch(base + 'QA-Hidden')).status).toBe(404);
    expect((await fetch(base + encodeURIComponent('<script>'))).status).toBe(400);
    expect(validName('a'.repeat(41))).toBe(false);
  });
  it('rate-limits a burst from one IP', async () => {
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) limited = (await fetch(base + 'Prof%20Tester')).status === 429;
    expect(limited).toBe(true);
  });
});
