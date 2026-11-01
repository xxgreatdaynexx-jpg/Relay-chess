import { beforeEach, describe, expect, it } from 'vitest';
import { RESPAWN_MS } from '../shared/fps.js';
import { claimArenaName, getArenaWorld, LIVE_MS, markArenaLive, registerArenaClient, resetArena } from '../server/fps.js';
import { resetBank } from '../server/casino-store.js';
import { isMissingAssetPath } from '../server/app.js';
import { isChunkLoadError, reloadOnceForChunkError } from '../client/src/lib/chunkReload.js';

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
