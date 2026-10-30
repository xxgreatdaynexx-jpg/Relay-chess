import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boardFor, isQaName } from '../shared/qa';
import { resetAccounts } from '../server/accounts.js';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { getArenaLedger, resetArenaLedger } from '../server/arena-store';

describe('QA names', () => {
  it('matches QA- prefix case-insensitively only', () => {
    expect(isQaName('QA-Tess')).toBe(true);
    expect(isQaName('qa-bot')).toBe(true);
    expect(isQaName(' Qa-x')).toBe(true);
    expect(isQaName('QAnon')).toBe(false);
    expect(isQaName('Dayne')).toBe(false);
    expect(isQaName(undefined)).toBe(false);
  });

  it('filters before top-N so ranks/limits ignore QA; QA viewers get tagged rows', () => {
    const rows = [{ name: 'QA-1' }, { name: 'A' }, { name: 'qa-2' }, { name: 'B' }, { name: 'C' }];
    expect(boardFor(rows, false, 2).map((r) => r.name)).toEqual(['A', 'B']);
    const qa = boardFor(rows, true);
    expect(qa.map((r) => r.name)).toEqual(['QA-1', 'A', 'qa-2', 'B', 'C']);
    expect(qa.filter((r) => r.qa).map((r) => r.name)).toEqual(['QA-1', 'qa-2']);
  });
});

describe('leaderboard endpoints hide QA unless the viewer is a signed-in QA account', () => {
  let ctx: AppContext;
  let base = '';
  let qaToken = '';
  let userToken = '';
  beforeAll(async () => {
    const acc = resetAccounts();
    resetArenaLedger();
    ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(ctx.httpServer.address() as AddressInfo).port}`;
    qaToken = (await acc.claim('QA-Tess', 'pass1', 'ip1')).token;
    userToken = (await acc.claim('Dayne', 'pass1', 'ip2')).token;
    const l = getArenaLedger();
    for (const n of ['QA-Tess', 'Dayne', 'qa-bot', 'Cole']) l.match(n);
    l.kill('QA-Tess', 1); l.kill('QA-Tess', 2); l.kill('Dayne', 1);
  });
  afterAll(async () => { await closeApp(ctx); });

  const arena = async (token?: string) =>
    ((await (await fetch(`${base}/api/arena-leaderboard`, token ? { headers: { 'X-Relay-Session': token } } : {})).json()) as { rows: { name: string; qa?: boolean }[] }).rows;

  it('keeps recording QA stats', () => {
    expect(getArenaLedger().standings().find((r) => r.name === 'QA-Tess')?.kills).toBe(2);
  });
  it('anonymous, normal and bogus sessions never see QA rows', async () => {
    for (const t of [undefined, userToken, 'x'.repeat(40)]) expect((await arena(t)).map((r) => r.name)).toEqual(['Dayne', 'Cole']);
  });
  it('a signed-in QA account sees QA rows tagged', async () => {
    const rows = await arena(qaToken);
    expect(rows.map((r) => r.name)).toEqual(['QA-Tess', 'Dayne', 'Cole', 'qa-bot']);
    expect(rows.filter((r) => r.qa).map((r) => r.name)).toEqual(['QA-Tess', 'qa-bot']);
  });
  it('chess and checkers boards also filter', async () => {
    for (const p of ['/api/leaderboard', '/api/checkers-leaderboard']) {
      const r = await fetch(base + p);
      expect(r.status).toBe(200);
      const rows = ((await r.json()) as { rows: { name: string }[] }).rows;
      expect(rows.some((x) => isQaName(x.name))).toBe(false);
    }
  });
});
