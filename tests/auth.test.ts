import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newDb } from 'pg-mem';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Accounts, hashPassword, MemoryAccountStore, PgAccountStore, RateLimiter, resetAccounts, SESSION_DAYS, verifyPassword } from '../server/accounts.js';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { resetLeaderboard } from '../server/leaderboard.js';

describe('password hashing', () => {
  it('salts and verifies', async () => {
    const a = await hashPassword('hunter2');
    const b = await hashPassword('hunter2');
    expect(a).not.toBe(b);
    expect(a).not.toContain('hunter2');
    expect(await verifyPassword('hunter2', a)).toBe(true);
    expect(await verifyPassword('hunter3', a)).toBe(false);
  });
});

describe('Accounts', () => {
  it('claims a name once, then needs the password', async () => {
    const acc = new Accounts(new MemoryAccountStore());
    expect(await acc.status('Dayne')).toEqual({ claimed: false, reserved: false });
    const { identity, token } = await acc.claim('Dayne', 'pass1', 'ip');
    expect(identity.name).toBe('Dayne');
    expect(await acc.status('dayne')).toEqual({ claimed: true, reserved: false });
    await expect(acc.claim('DAYNE', 'other', 'ip2')).rejects.toThrow(/already taken/);
    await expect(acc.login('dayne', 'nope', 'ip')).rejects.toThrow(/Wrong password/);
    const ok = await acc.login('dayne', 'pass1', 'ip');
    expect(ok.identity.name).toBe('Dayne');
    expect((await acc.resume(token))?.name).toBe('Dayne');
  });

  it('rejects short passwords and Guest names', async () => {
    const acc = new Accounts(new MemoryAccountStore());
    await expect(acc.claim('Bob', 'abc', 'ip')).rejects.toThrow(/at least 4/);
    await expect(acc.claim('Guest123', 'abcd', 'ip')).rejects.toThrow(/reserved/);
  });

  it('expires sessions after 90 days and on logout', async () => {
    const acc = new Accounts(new MemoryAccountStore());
    const t0 = 1_000_000;
    const { token } = await acc.claim('Ann', 'pass1', 'ip', t0);
    expect(await acc.resume(token, t0 + (SESSION_DAYS - 1) * 86_400_000)).not.toBeNull();
    expect(await acc.resume(token, t0 + SESSION_DAYS * 86_400_000 + 1)).toBeNull();
    const again = await acc.login('Ann', 'pass1', 'ip', t0);
    await acc.logout(again.token);
    expect(await acc.resume(again.token, t0)).toBeNull();
    expect(await acc.resume('x'.repeat(40), t0)).toBeNull();
  });

  it('rate limits wrong passwords per name with growing lockouts', async () => {
    const acc = new Accounts(new MemoryAccountStore());
    const now = 5_000_000;
    await acc.claim('Cy', 'right', 'a', now);
    for (let i = 0; i < 5; i++) await expect(acc.login('Cy', 'wrong', `ip${i}`, now)).rejects.toThrow(/Wrong/);
    await expect(acc.login('Cy', 'right', 'other', now)).rejects.toThrow(/Too many tries/);
    expect((await acc.login('Cy', 'right', 'other', now + 61_000)).identity.name).toBe('Cy');
    const rl = new RateLimiter(5, 60_000, 60_000);
    for (let i = 0; i < 5; i++) rl.fail('k', 0);
    expect(rl.blocked('k', 0)).toBe(60);
    for (let i = 0; i < 5; i++) rl.fail('k', 61_000);
    expect(rl.blocked('k', 61_000)).toBe(120);
  });

  it('persists in postgres (pg-mem)', async () => {
    const db = newDb({ noAstCoverageCheck: true });
    const { Pool } = db.adapters.createPg();
    const store = new PgAccountStore(new Pool());
    await store.init();
    await store.init();
    const acc = new Accounts(store);
    const { token } = await acc.claim('Neo', 'matrix', 'ip');
    const rows = db.public.many('SELECT * FROM players');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].password_hash)).not.toContain('matrix');
    const fresh = new Accounts(store);
    expect((await fresh.resume(token))?.name).toBe('Neo');
    expect((await fresh.login('neo', 'matrix', 'ip')).identity.name).toBe('Neo');
    await store.setSettings('neo', { theme: 'light' });
    await store.setSettings('neo', { theme: 'dark' });
    expect(await store.getSettings('neo')).toEqual({ theme: 'dark' });
    expect(db.public.many('SELECT * FROM player_settings')).toHaveLength(1);
    await store.setPassword('neo', await hashPassword('zion'));
    expect((await fresh.login('Neo', 'zion', 'ip')).identity.name).toBe('Neo');
    expect(await store.remove('neo')).toBe(true);
    expect(await fresh.resume(token)).toBeNull();
  });
});

describe('sockets require a signed-in name', () => {
  let ctx: AppContext;
  let port = 0;
  const opened: Socket[] = [];
  beforeAll(async () => {
    resetAccounts();
    resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-auth-')), 'leaderboard.json'));
    ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    port = (ctx.httpServer.address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const s of opened) s.disconnect();
    await closeApp(ctx);
  });
  const connect = (session?: string) => {
    const s = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, auth: session ? { session } : {} });
    opened.push(s);
    return s;
  };
  const ask = (s: Socket, ev: string, data: unknown = {}) =>
    new Promise<Record<string, any>>((r) => s.emit(ev, data, r));

  it('blocks join, seat, casino bets and name spoofing without the password', async () => {
    const owner = connect();
    const claimed = await ask(owner, 'auth_claim', { name: 'Dayne', password: 'secret1' });
    expect(claimed.ok).toBe(true);
    expect(JSON.stringify(claimed)).not.toContain('secret1');
    const made = await ask(owner, 'create_room', { name: 'Ignored', clockId: (await import('../shared/types.js')).CLOCK_PRESETS[0].id, mode: '2v2' });
    expect(made.ok).toBe(true);

    const thief = connect();
    expect((await ask(thief, 'auth_status', { name: 'dayne' })).claimed).toBe(true);
    expect((await ask(thief, 'auth_login', { name: 'Dayne', password: 'wrong' })).error).toMatch(/Wrong password/);
    for (const ev of ['join_room', 'quick_join', 'tournament_create', 'bj_join']) {
      const res = await ask(thief, ev, { name: 'Dayne', code: made.code, clockId: 'x', size: 4 });
      expect(res.ok, ev).toBe(false);
      expect(res.error, ev).toMatch(/Sign in/);
    }
    expect((await ask(thief, 'bj_bet', { amount: 10 })).ok).toBe(false);
    expect((await ask(thief, 'roulette_bet', { bet: { kind: 'red', amount: 10 } })).ok).toBe(false);
    // spectating is open
    expect((await ask(thief, 'spectate', { code: made.code })).ok).toBe(true);
    expect((await ask(thief, 'roulette_watch')).ok).toBe(true);
  });

  it('changes the password (needs the current one) and saves validated settings per account', async () => {
    const a = connect();
    expect((await ask(a, 'settings_save', { settings: { theme: 'light' } })).error).toMatch(/Sign in/);
    expect((await ask(a, 'auth_change_password', { current: 'x', next: 'yyyy' })).error).toMatch(/Sign in/);
    await ask(a, 'auth_claim', { name: 'Prefs', password: 'old-pass' });
    expect((await ask(a, 'auth_change_password', { current: 'nope', next: 'new-pass' })).error).toMatch(/current password is wrong/);
    expect((await ask(a, 'auth_change_password', { current: 'old-pass', next: 'ab' })).error).toMatch(/at least 4/);
    expect((await ask(a, 'auth_change_password', { current: 'old-pass', next: 'new-pass' })).ok).toBe(true);
    const b = connect();
    expect((await ask(b, 'auth_login', { name: 'Prefs', password: 'old-pass' })).ok).toBe(false);
    expect((await ask(b, 'auth_login', { name: 'Prefs', password: 'new-pass' })).ok).toBe(true);
    expect((await ask(b, 'settings_get')).settings).toBeNull();
    const saved = await ask(b, 'settings_save', { settings: { theme: 'contrast', accent: 'javascript:1', boardLight: '#EEEED2', volume: 9, evil: 'x' } });
    expect(saved.ok).toBe(true);
    expect(saved.settings).toMatchObject({ theme: 'contrast', accent: '#e0b56a', boardLight: '#eeeed2', volume: 1 });
    expect(saved.settings.evil).toBeUndefined();
    expect((await ask(a, 'settings_get')).settings.theme).toBe('contrast');
    expect((await ask(b, 'settings_save', { settings: 'nope' })).ok).toBe(false);
    expect((await ask(b, 'settings_save', { settings: { theme: 'x'.repeat(3000) } })).ok).toBe(false);
  });

  it('a session token signs a new socket in; logout ends it', async () => {
    const a = connect();
    const res = await ask(a, 'auth_claim', { name: 'Tokyo', password: 'pass1' });
    const b = connect(res.session);
    expect((await ask(b, 'auth_status', { name: 'Tokyo' })).you).toBe('Tokyo');
    expect((await ask(b, 'bj_join')).ok).toBe(true);
    await ask(b, 'auth_logout', { session: res.session });
    const c = connect(res.session);
    expect((await ask(c, 'auth_status', { name: 'Tokyo' })).you).toBeNull();
    expect((await ask(c, 'bj_join')).ok).toBe(false);
  });
});
