import { beforeEach, describe, expect, it } from 'vitest';
import { ArenaWorld, END_SCREEN_MS, MATCH_MS, SUDDEN_MS, type MatchResult } from '../server/arena-world.js';
import { claimArenaName, getArenaWorld, MATCH_PRIZE, onArenaMatchEnd, resetArena } from '../server/fps.js';
import { resetBank } from '../server/casino-store.js';
import { RESPAWN_MS } from '../shared/fps.js';

const T0 = 1_000_000;
function world3() {
  const w = new ArenaWorld();
  const res: MatchResult[] = [];
  w.onMatchEnd = (r) => res.push(r);
  const a = w.join('a', 'A', T0), b = w.join('b', 'B', T0), c = w.join('c', 'C', T0);
  return { w, a, b, c, res };
}

describe('arena timed matches with sudden death', () => {
  beforeEach(() => { resetArena(); resetBank(); });

  it('3 min of respawning play, then sudden death: no respawns, last alive wins, end screen, next match', () => {
    const { w, a, b, c, res } = world3();
    expect(MATCH_MS).toBe(180_000);
    // a dies before the switch and has not respawned yet when it hits
    a.alive = false; a.respawnAt = T0 + MATCH_MS + 5000;
    const ev = w.tick(T0 + MATCH_MS);
    expect(w.phase).toBe('sudden');
    expect(ev.some((e) => e.ev === 'fps_sudden')).toBe(true);
    w.tick(T0 + MATCH_MS + 10_000);
    expect(a.alive).toBe(false); // final
    b.alive = false; b.kills = 0; c.kills = 2;
    const end = w.tick(T0 + MATCH_MS + 11_000);
    expect(w.phase).toBe('ended');
    expect(end.find((e) => e.ev === 'fps_match_end')).toBeTruthy();
    expect(res).toHaveLength(1);
    expect(res[0].winnerId).toBe('c');
    expect(res[0].reason).toBe('last-alive');
    expect(res[0].players[0].id).toBe('c');
    expect(res[0].players.every((p) => p.participationMs > 0)).toBe(true);
    expect(w.shoot('c', 0, T0 + MATCH_MS + 12_000)).toEqual([]);
    // late joiner spectates; end screen leads to a fresh match where everyone plays again
    const d = w.join('d', 'D', T0 + MATCH_MS + 12_000);
    expect(d.alive).toBe(false);
    const t1 = T0 + MATCH_MS + 11_000 + END_SCREEN_MS;
    w.tick(t1);
    expect(w.phase).toBe('play');
    expect(c.kills).toBe(0);
    w.tick(t1 + RESPAWN_MS + 50);
    expect([a, b, c, d].every((f) => f.alive)).toBe(true);
    expect(res).toHaveLength(1);
  });

  it('ends at the cap on most kills then fewest deaths, and immediately with 0-1 alive at the switch', () => {
    const { w, a, b, c, res } = world3();
    w.tick(T0 + MATCH_MS);
    Object.assign(a, { kills: 3, deaths: 2 }); Object.assign(b, { kills: 3, deaths: 1 }); Object.assign(c, { kills: 1 });
    w.tick(T0 + MATCH_MS + SUDDEN_MS);
    expect(res[0].reason).toBe('cap');
    expect(res[0].winnerId).toBe('b');
    const x = world3();
    x.a.alive = false; x.b.alive = false; x.a.respawnAt = x.b.respawnAt = T0 + MATCH_MS + 999;
    x.w.tick(T0 + MATCH_MS);
    expect(x.w.phase).toBe('ended');
    expect(x.res[0].winnerId).toBe('c');
  });

  it('winner gets 300 chips once per match, only with 2+ signed-in humans; bots and solo farms get nothing', () => {
    const bank = resetBank();
    const seen: string[] = [];
    const off = onArenaMatchEnd((r) => seen.push(r.matchId));
    claimArenaName('h1', 'Hana'); claimArenaName('h2', 'Ivo');
    const w = getArenaWorld();
    const h1 = w.join('h1', 'Hana', T0), h2 = w.join('h2', 'Ivo', T0);
    const before = bank.account('Hana').chips;
    w.tick(T0 + MATCH_MS);
    h2.alive = false;
    w.tick(T0 + MATCH_MS + 1000);
    expect(w.lastResult?.winnerId).toBe('h1');
    expect(w.lastResult?.prize).toEqual({ name: 'Hana', amount: MATCH_PRIZE });
    expect(bank.account('Hana').chips).toBe(before + 300);
    expect(seen).toHaveLength(1);
    // solo human vs a bot: no prize
    resetArena();
    claimArenaName('h1', 'Hana');
    const w2 = getArenaWorld();
    w2.join('h1', 'Hana', T0); const bot = w2.join('arena-bot-1', 'Bot', T0);
    const mid = bank.account('Hana').chips;
    w2.tick(T0 + MATCH_MS); bot.alive = false; w2.tick(T0 + MATCH_MS + 1000);
    expect(w2.lastResult?.winnerId).toBe('h1');
    expect(w2.lastResult?.prize).toBeUndefined();
    expect(bank.account('Hana').chips).toBe(mid);
    off();
    void h1;
  });
});
