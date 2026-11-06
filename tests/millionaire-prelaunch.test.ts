import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import {
  MILLIONAIRE_PRELAUNCH_START_MS,
  MILLIONAIRE_PRELAUNCH_END_MS,
  MILLIONAIRE_PRELAUNCH_HEADLINE,
  MILLIONAIRE_PRELAUNCH_MSG,
  isMillionairePrelaunch,
  millionairePrelaunchView,
  formatCountdown,
} from '../shared/millionairePrelaunch';
import { isHubAwake, HUB_SLEEP_MSG } from '../shared/hubSleep';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { resetLeaderboard } from '../server/leaderboard.js';
import { ensureSignedIn } from './auth-helper';

const T = {
  at1900: Date.parse('2026-11-07T01:00:00.000Z'),
  at194459: Date.parse('2026-11-07T01:44:59.000Z'),
  at1945: Date.parse('2026-11-07T01:45:00.000Z'),
  at1950: Date.parse('2026-11-07T01:50:00.000Z'),
  at2000: Date.parse('2026-11-07T02:00:00.000Z'),
};

describe('Millionaire prelaunch window (UTC constants)', () => {
  it('half-open [19:45, 20:00) UTC-6; 19:00 and 19:44:59 playable, 19:45 locked, 20:00 released', () => {
    expect(MILLIONAIRE_PRELAUNCH_START_MS).toBe(Date.parse('2026-11-07T01:45:00.000Z'));
    expect(MILLIONAIRE_PRELAUNCH_END_MS).toBe(Date.parse('2026-11-07T02:00:00.000Z'));
    expect(isMillionairePrelaunch(T.at1900)).toBe(false);
    expect(isMillionairePrelaunch(T.at194459)).toBe(false);
    expect(isMillionairePrelaunch(T.at1945)).toBe(true);
    expect(isMillionairePrelaunch(T.at1950)).toBe(true);
    expect(isMillionairePrelaunch(T.at2000)).toBe(false);
  });

  it('visible headline is exactly “Millionaire Update” (no coming)', () => {
    expect(MILLIONAIRE_PRELAUNCH_HEADLINE).toBe('Millionaire Update');
    expect(MILLIONAIRE_PRELAUNCH_MSG).toBe('Millionaire Update');
    expect(MILLIONAIRE_PRELAUNCH_HEADLINE.toLowerCase()).not.toContain('coming');
    expect(millionairePrelaunchView(T.at1950).headline).toBe('Millionaire Update');
  });

  it('overnight hub sleep schedule and message unchanged', () => {
    const overnight = Date.parse('2026-11-07T09:00:00.000Z');
    expect(isHubAwake(overnight)).toBe(false);
    expect(isMillionairePrelaunch(overnight)).toBe(false);
    expect(HUB_SLEEP_MSG).toMatch(/sleeps so should you/i);
    expect(isHubAwake(T.at1900)).toBe(true);
  });

  it('formatCountdown', () => {
    expect(formatCountdown(65_000)).toBe('01:05');
    expect(formatCountdown(0)).toBe('00:00');
  });
});

describe('Millionaire prelaunch — changelog + visible copy', () => {
  it('maintenance entry present; never mentions protesters; overlay has no coming/buttons', () => {
    const raw = readFileSync(resolve('shared/changelog.ts'), 'utf8');
    expect(raw).toMatch(/Short maintenance before Millionaire Update/);
    expect(raw.toLowerCase()).not.toMatch(/protest/);
    const overlay = readFileSync(resolve('client/src/components/MillionairePrelaunchOverlay.tsx'), 'utf8');
    expect(overlay).toContain('Millionaire Update');
    expect(overlay).toMatch(/data-testid="millionaire-prelaunch-timer"/);
    expect(overlay.toLowerCase()).not.toContain("'coming'");
    expect(overlay.toLowerCase()).not.toContain('"coming"');
    expect(overlay).not.toMatch(/<button/i);
  });
});

describe('Millionaire prelaunch server enforcement (existing session + HTTP)', () => {
  let ctx: AppContext;
  let port = 0;
  const opened: Socket[] = [];
  let nowMs = Date.now();
  const realNow = Date.now;

  beforeAll(async () => {
    Date.now = () => nowMs;
    resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-prelaunch-')), 'lb.json'));
    ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    port = (ctx.httpServer.address() as AddressInfo).port;
  });
  afterAll(async () => {
    Date.now = realNow;
    for (const s of opened) s.disconnect();
    await closeApp(ctx);
  });

  const base = () => `http://127.0.0.1:${port}`;
  const connect = () => {
    const s = ioClient(base(), { transports: ['websocket'], forceNew: true });
    opened.push(s);
    return s;
  };
  const ask = (s: Socket, ev: string, data: unknown = {}) =>
    new Promise<Record<string, unknown>>((r) => s.emit(ev, data, (x: Record<string, unknown>) => r(x)));

  it('19:44:59 open; 19:45 blocks HTTP + socket on already-connected client; health/admin status ok; 20:00 releases', async () => {
    nowMs = T.at194459;
    let r = await fetch(`${base()}/api/hiscores?skill=overall`);
    expect(r.status).not.toBe(503);

    const s = connect();
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('connect timeout')), 5000);
      s.on('connect', () => { clearTimeout(t); res(); });
    });
    await ensureSignedIn(s, { name: 'PrelaunchQA' });
    const openAsk = await ask(s, 'hub_status', {});
    expect(openAsk.ok).toBe(true);

    nowMs = T.at1945;
    r = await fetch(`${base()}/api/health`);
    expect(r.status).toBe(200);
    r = await fetch(`${base()}/api/build`);
    expect(r.status).toBe(200);
    r = await fetch(`${base()}/api/millionaire-prelaunch`);
    expect(r.status).toBe(200);
    const st = await r.json() as { active: boolean; headline: string };
    expect(st.active).toBe(true);
    expect(st.headline).toBe('Millionaire Update');

    r = await fetch(`${base()}/api/hiscores?skill=overall`);
    expect(r.status).toBe(503);
    const body = await r.json() as { kind?: string; error?: string; headline?: string };
    expect(body.kind).toBe('millionaire_prelaunch');
    expect(body.error).toBe('Millionaire Update');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('coming');

    // Existing socket session: play events refused (not UI-only)
    const blocked = await ask(s, 'create_room', { clockId: '5+0', mode: '2v2' });
    expect(blocked.ok).toBe(false);
    expect(blocked.kind).toBe('millionaire_prelaunch');
    expect(blocked.error).toBe('Millionaire Update');

    const status = await ask(s, 'prelaunch_status', {});
    expect(status.ok).toBe(true);
    expect(status.active).toBe(true);

    nowMs = T.at2000;
    r = await fetch(`${base()}/api/millionaire-prelaunch`);
    expect((await r.json() as { active: boolean }).active).toBe(false);
    const after = await ask(s, 'prelaunch_status', {});
    expect(after.active).toBe(false);
  });
});
