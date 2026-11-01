import { beforeEach, describe, expect, it } from 'vitest';
import { RESPAWN_MS } from '../shared/fps.js';
import { armArenaClient, claimArenaName, getArenaWorld, isArenaClientLive, LIVE_MS, markArenaLive, registerArenaClient, resetArena, touchArenaClient } from '../server/fps.js';
import { resetBank } from '../server/casino-store.js';
import { isMissingAssetPath } from '../server/app.js';
import { importWithReload, isChunkLoadError, reloadOnceForChunkError } from '../client/src/lib/chunkReload.js';

describe('arena: no spawn or charge until the client is rendering', () => {
  beforeEach(() => { resetArena(); resetBank(); });

  it('a joined client whose 3D engine never loaded is never charged, even across many respawn ticks', () => {
    const bank = resetBank();
    bank.account('dead-tab');
    const before = bank.account('dead-tab').chips;
    const w = getArenaWorld();
    claimArenaName('s1', 'dead-tab');
    registerArenaClient('s1', false, 1000);
    const f = w.join('s1', 'dead-tab', 1000, 'pistol');
    expect(f.alive).toBe(false);
    expect(f.broke).toBe(false);
    for (let t = 1000; t < 1000 + 120_000; t += 500) w.tick(t);
    expect(w.fighters.get('s1')!.alive).toBe(false);
    expect(bank.account('dead-tab').chips).toBe(before);
  });

  it('spawns and charges once the client is live; stops auto-respawning when it goes quiet', () => {
    const bank = resetBank();
    const start = bank.account('live').chips;
    const w = getArenaWorld();
    claimArenaName('s2', 'live');
    registerArenaClient('s2', true, 1000);
    armArenaClient('s2'); // the player clicked Play
    const f = w.join('s2', 'live', 1000, 'pistol');
    expect(f.alive).toBe(true);
    const afterFirst = bank.account('live').chips;
    expect(afterFirst).toBeLessThan(start);
    // dies; client stopped rendering (no heartbeat) -> no further paid respawns
    f.alive = false; f.hp = 0; f.stake = 0; f.respawnAt = 2000 + LIVE_MS + RESPAWN_MS; void RESPAWN_MS;
    for (let t = 2000 + LIVE_MS; t < 2000 + LIVE_MS + 60_000; t += 500) w.tick(t);
    expect(bank.account('live').chips).toBe(afterFirst);
    expect(f.alive).toBe(false);
    // heartbeat resumes -> respawns (and pays) again
    const t2 = 2000 + LIVE_MS + 61_000;
    markArenaLive('s2', t2);
    w.tick(t2);
    expect(f.alive).toBe(true);
    expect(bank.account('live').chips).toBeLessThan(afterFirst);
  });
});

describe('static assets', () => {
  it('missing hashed assets are 404s, SPA routes are not', () => {
    expect(isMissingAssetPath('/assets/arena3d-BFk6VsQP.js')).toBe(true);
    expect(isMissingAssetPath('/assets/nonexistent-abc.js')).toBe(true);
    expect(isMissingAssetPath('/assets/x.css')).toBe(true);
    expect(isMissingAssetPath('/arena')).toBe(false);
    expect(isMissingAssetPath('/')).toBe(false);
    expect(isMissingAssetPath('/api/health')).toBe(false);
  });
});

describe('chunk-load reload guard', () => {
  const env = () => { const m = new Map<string, string>(); let n = 0; return { n: () => n, storage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }, reload: () => { n++; }, now: () => 5_000_000 }; };
  it('reloads once on a dynamic-import error and never loops', () => {
    const e = env();
    const err = new TypeError('Failed to fetch dynamically imported module: https://chudhub.club/assets/arena3d-BFk6VsQP.js');
    expect(isChunkLoadError(err)).toBe(true);
    expect(reloadOnceForChunkError(err, e)).toBe(true);
    expect(reloadOnceForChunkError(err, e)).toBe(false);
    expect(e.n()).toBe(1);
  });
  it('ignores unrelated errors', () => {
    const e = env();
    expect(reloadOnceForChunkError(new Error('boom'), e)).toBe(false);
    expect(e.n()).toBe(0);
  });
});

describe('spawn gate fails closed for old / unknown clients', () => {
  beforeEach(() => { resetArena(); resetBank(); });
  it('opening the Arena (join, ready, heartbeating) never spawns or charges until the player clicks Play', () => {
    const bank = resetBank();
    const start = bank.account('opener').chips;
    const w = getArenaWorld();
    claimArenaName('p1', 'opener');
    registerArenaClient('p1', true, 1000);
    const f = w.join('p1', 'opener', 1000, 'pistol');
    expect(f.alive).toBe(false);
    for (let t = 1000; t < 61_000; t += 500) { markArenaLive('p1', t); touchArenaClient('p1', t); w.tick(t); }
    expect(f.alive).toBe(false);
    expect(bank.account('opener').chips).toBe(start);
    // explicit Play click (server: fps_respawn arms the socket) -> spawns and pays exactly once
    armArenaClient('p1'); markArenaLive('p1', 61_000); w.requestRespawn('p1', 'pistol', 61_000); w.tick(61_000);
    expect(f.alive).toBe(true);
    expect(bank.account('opener').chips).toBe(start - 10);
    w.tick(61_500);
    expect(bank.account('opener').chips).toBe(start - 10);
  });
  it('the server arms a socket only on fps_respawn, and a (re)join disarms it', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('server/fps.ts', 'utf8');
    expect(src).toMatch(/socket\.on\('fps_respawn'[^\n]*armed\.add\(socket\.id\)/);
    expect(src.match(/armed\.add\(/g)?.length).toBe(2); // fps_respawn + the test hook
    expect(src).toMatch(/armed\.delete\(socket\.id\); \/\/ a \(re\)join never spawns/);
    const panel = readFileSync('client/src/components/ArenaPanel.tsx', 'utf8');
    expect(panel).toMatch(/data-testid="arena-play-btn"[^\n]*onClick=\{\(\) => respawnNow\(\)\}/);
  });
  it('an old client that never sends ready is never charged, even while it sends moves and respawn clicks', () => {
    const bank = resetBank();
    const before = bank.account('old').chips;
    const w = getArenaWorld();
    claimArenaName('o1', 'old');
    registerArenaClient('o1', false, 1000);
    const f = w.join('o1', 'old', 1000, 'pistol');
    for (let t = 1000; t < 61_000; t += 500) { touchArenaClient('o1', t); w.requestRespawn('o1', 'pistol', t); w.tick(t); }
    expect(f.alive).toBe(false);
    expect(bank.account('old').chips).toBe(before);
  });
  it('a socket that never registered (reconnect / reset) is not live', () => {
    expect(isArenaClientLive('never-joined', 5000)).toBe(false);
    registerArenaClient('r1', false, 1000);
    expect(isArenaClientLive('r1', 1000)).toBe(false);
    markArenaLive('r1', 2000);
    expect(isArenaClientLive('r1', 2000)).toBe(true);
    expect(isArenaClientLive('r1', 2000 + LIVE_MS + 1)).toBe(false);
  });
});

describe('every lazy import reloads once on a stale chunk', () => {
  it('importWithReload reloads once and stays pending; rethrows after', async () => {
    const m = new Map<string, string>(); let n = 0;
    const env = { storage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }, reload: () => { n++; }, now: () => 9_000_000 };
    const err = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: https://chudhub.club/assets/Dealership-u2uD7tHU.js'));
    const p = importWithReload(err, env);
    const r = await Promise.race([p.then(() => 'resolved', () => 'rejected'), new Promise((res) => setTimeout(() => res('pending'), 20))]);
    expect(r).toBe('pending');
    expect(n).toBe(1);
    await expect(importWithReload(err, env)).rejects.toThrow(/dynamically imported/);
    expect(n).toBe(1);
  });
  it('no client code uses a bare lazy() or unwrapped dynamic import()', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const bad: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(e) && !/lazyWithReload|chunkReload/.test(e)) {
      readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/(^|[^\w.])lazy\(/.test(l) || (/(^|[^\w>] ?)import\(/.test(l) && !/(importWithReload|lazyWithReload)\(\(\) => import\(/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/typeof import\(/.test(l))) bad.push(`${p}:${i + 1}`); }); } } };
    walk('client/src');
    expect(bad).toEqual([]);
  });
});
