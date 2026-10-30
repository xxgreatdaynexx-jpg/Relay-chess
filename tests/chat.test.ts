import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { io as ioClient, type Socket } from 'socket.io-client';
import { CHAT_MAX_LEN, cleanActivities, sanitizeChat, validateChat, whereLabel } from '../shared/chat';
import { buildSnapshot, ChatLog, ChatRateLimiter, PgChatStore, resetChatLog, getChatLog } from '../server/chat';
import { resetAccounts } from '../server/accounts.js';
import { closeApp, createApp, type AppContext } from '../server/app.js';

describe('chat sanitizing and limits', () => {
  it('strips HTML/control chars but keeps the words (no censoring)', () => {
    expect(sanitizeChat('<b>hi</b> <script>alert(1)</script>there')).toBe('hi alert(1)there');
    expect(sanitizeChat('<img src=x onerror=alert(1)>damn  it\n\u0007ok')).toBe('damn it ok');
    expect(sanitizeChat('a < b > c <3')).toBe('a < b > c <3');
    expect(sanitizeChat('x<a href="javascript:1">y</a><!-- z -->')).toBe('xy');
    expect(sanitizeChat(42)).toBe('');
    expect(validateChat('   ').ok).toBe(false);
    expect(validateChat('<br>').ok).toBe(false);
  });
  it('enforces the length limit after sanitizing', () => {
    expect(validateChat('x'.repeat(CHAT_MAX_LEN))).toEqual({ ok: true, text: 'x'.repeat(CHAT_MAX_LEN) });
    expect(validateChat('x'.repeat(CHAT_MAX_LEN + 1)).ok).toBe(false);
    expect(validateChat(`<i>${'x'.repeat(CHAT_MAX_LEN)}</i>`).ok).toBe(true);
  });
  it('rate limits per user: min gap and burst window', () => {
    const rl = new ChatRateLimiter(5, 10_000, 600);
    expect(rl.take('a', 0).ok).toBe(true);
    expect(rl.take('a', 100).ok).toBe(false);
    expect(rl.take('b', 100).ok).toBe(true);
    for (let i = 1; i < 5; i++) expect(rl.take('a', i * 1000).ok).toBe(true);
    expect(rl.take('a', 5000).ok).toBe(false);
    expect(rl.take('a', 10_001).ok).toBe(true);
  });
  it('ChatLog rejects unsigned spam and caps history', () => {
    const log = new ChatLog(5);
    for (let i = 0; i < 8; i++) expect(log.post('Dayne', `m${i}`, i * 3000).ok).toBe(true);
    expect(log.size).toBe(5);
    expect(log.history(false).map((m) => m.text)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7']);
    expect(log.post('Dayne', 'too fast', 21100).ok).toBe(false);
  });
  it('hides QA messages from non-QA viewers', () => {
    const log = new ChatLog();
    log.post('QA-Tess', 'qa test', 0);
    log.post('Dayne', 'hello', 0);
    expect(log.history(false).map((m) => m.name)).toEqual(['Dayne']);
    expect(log.history(true).find((m) => m.name === 'QA-Tess')?.qa).toBe(true);
  });
  it('persists to postgres, reloads, and prunes to the cap', async () => {
    const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
    const pool = new Pool();
    const a = new ChatLog(3);
    expect(await a.attach(new PgChatStore(pool))).toBe(true);
    expect(await a.attach(new PgChatStore(pool))).toBe(true); // idempotent migration
    for (let i = 0; i < 25; i++) a.post(`U${i}`, `t${i}`, 1000 + i);
    await a.flush();
    const b = new ChatLog(3);
    await b.attach(new PgChatStore(pool));
    expect(b.history(false).map((m) => m.text)).toEqual(['t22', 't23', 't24']);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM chat_messages');
    expect(Number(rows[0].n)).toBeLessThanOrEqual(8);
  });
});

describe('presence', () => {
  const tt = (code: string) => (code === 'GONE' ? null : code === 'CHK1' ? 'checkers' : 'chess') as 'chess' | 'checkers' | null;
  it('tracks location, merges tabs, counts guests, excludes bots and hides QA', () => {
    const snap = buildSnapshot([
      { name: 'Dayne', code: 'AB12', activities: [] },
      { name: 'dayne', activities: ['slots'] },
      { name: 'Cole', code: 'CHK1', spectating: true, activities: ['arena'] },
      { name: 'Nora', code: 'GONE', activities: [] },
      { name: null, activities: [] },
      { name: 'Bot 650 · Rook', activities: [] },
      { name: 'QA-Tess', activities: ['blackjack'] },
    ], false, tt);
    expect(snap.guests).toBe(1);
    expect(snap.users.map((u) => u.name)).toEqual(['Cole', 'Dayne', 'Nora']);
    const d = snap.users.find((u) => u.name === 'Dayne')!;
    expect(d.table).toEqual({ code: 'AB12', gameType: 'chess', watching: false });
    expect(d.where).toBe('Chess · AB12 · Slots');
    expect(snap.users.find((u) => u.name === 'Cole')!.where).toBe('Watching · CHK1 · Arena');
    expect(snap.users.find((u) => u.name === 'Nora')!.where).toBe('Lobby');
    const qa = buildSnapshot([{ name: 'QA-Tess', activities: ['blackjack'] }], true, tt);
    expect(qa.users[0]).toMatchObject({ name: 'QA-Tess', qa: true, where: 'Blackjack' });
  });
  it('validates reported activities', () => {
    expect(cleanActivities(['arena', 'arena', 'hack', 5, 'slots'])).toEqual(['arena', 'slots']);
    expect(cleanActivities('arena')).toEqual([]);
    expect(whereLabel(null, [])).toBe('Lobby');
  });
});

describe('chat + online over sockets', () => {
  let ctx: AppContext;
  let base = '';
  const socks: Socket[] = [];
  beforeAll(async () => {
    resetAccounts();
    resetChatLog();
    ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(ctx.httpServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => { for (const s of socks) s.close(); await closeApp(ctx); });
  const connect = async () => { const s = ioClient(base, { transports: ['websocket'], forceNew: true }); socks.push(s); await new Promise<void>((r) => s.once('connect', () => r())); return s; };
  const call = <T,>(s: Socket, ev: string, data: unknown = {}) => new Promise<T>((r) => s.emit(ev, data, r));

  it('guests cannot post; signed-in users broadcast; QA hidden from others; history endpoint works', async () => {
    const guest = await connect();
    expect((await call<{ ok: boolean }>(guest, 'chat_send', { text: 'hi' })).ok).toBe(false);
    const a = await connect();
    await call(a, 'auth_claim', { name: 'Dayne', password: 'test-pass-123' });
    const q = await connect();
    await call(q, 'auth_claim', { name: 'QA-Tess', password: 'test-pass-123' });
    a.emit('presence', { activities: ['arena', 'bogus'] });
    const got = new Promise<{ text: string; name: string }>((r) => guest.once('chat_msg', r));
    const res = await call<{ ok: boolean }>(a, 'chat_send', { text: '<b>hello</b> world' });
    expect(res.ok).toBe(true);
    expect(await got).toMatchObject({ name: 'Dayne', text: 'hello world' });
    expect((await call<{ ok: boolean }>(a, 'chat_send', { text: 'again' })).ok).toBe(false); // rate limited
    expect((await call<{ ok: boolean }>(q, 'chat_send', { text: 'qa only' })).ok).toBe(true);
    const pub = (await (await fetch(`${base}/api/chat`)).json()) as { messages: { name: string }[]; source: string };
    expect(pub.messages.map((m) => m.name)).toEqual(['Dayne']);
    expect(pub.source).toBe('memory');
    expect(getChatLog().size).toBe(2);
    const on = await call<{ users: { name: string; where: string }[]; guests: number }>(guest, 'online_get');
    expect(on.users).toEqual([expect.objectContaining({ name: 'Dayne', where: 'Arena' })]);
    expect(on.guests).toBe(1);
    const onQa = await call<{ users: { name: string }[] }>(q, 'online_get');
    expect(onQa.users.map((u) => u.name)).toEqual(['Dayne', 'QA-Tess']);
  });
});
