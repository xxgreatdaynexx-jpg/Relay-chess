import { describe, expect, it } from 'vitest';
import { ArenaWorld, MATCH_MS } from '../server/arena-world.js';
import { MAX_HP, REGEN_DELAY_MS, REGEN_HPS, RESPAWN_MS, RESPAWN_PICK_MS, TICK_HZ } from '../shared/fps.js';

const T0 = 1_000_000;
const STEP = Math.round(1000 / TICK_HZ);
type Dmg = { damage: (by: string | null, t: string, n: number, now: number, cause: string) => unknown };
const hurt = (w: ArenaWorld, by: string, t: string, n: number, now: number) => (w as unknown as Dmg).damage(by, t, n, now, 'pistol');
function run(w: ArenaWorld, from: number, to: number) { for (let t = from; t <= to; t += STEP) w.tick(t); }

describe('death screen: 8 s loadout pick, Respawn button', () => {
  it('humans stay dead for 8 s, then auto-respawn with the picked loadout', () => {
    const w = new ArenaWorld();
    const a = w.join('a', 'A', T0), b = w.join('b', 'B', T0);
    hurt(w, 'a', 'b', 9999, T0 + 100);
    expect(b.alive).toBe(false);
    w.setLoadout('b', 'smg', T0 + 200);
    run(w, T0 + 100, T0 + 100 + RESPAWN_PICK_MS - STEP);
    expect(b.alive).toBe(false); // not at the old 2 s
    run(w, T0 + 100 + RESPAWN_PICK_MS - STEP, T0 + 100 + RESPAWN_PICK_MS + STEP);
    expect(b.alive).toBe(true);
    expect(b.weapon).toBe('smg');
    expect(a.alive).toBe(true);
  });

  it('Respawn button spawns at once with the chosen loadout; ignored while alive or in sudden death', () => {
    const w = new ArenaWorld();
    w.join('a', 'A', T0); const b = w.join('b', 'B', T0);
    expect(w.requestRespawn('b', 'shotgun', T0)).toBe(false); // alive
    hurt(w, 'a', 'b', 9999, T0 + 100);
    expect(w.snapshotFor('b', T0 + 1100).players.find((p) => p.id === 'b')?.rs).toBe(RESPAWN_PICK_MS - 1000);
    expect(w.requestRespawn('b', 'shotgun', T0 + 1000)).toBe(true);
    w.tick(T0 + 1000 + STEP);
    expect(b.alive).toBe(true);
    expect(b.weapon).toBe('shotgun');
    // sudden death: no respawns at all
    w.join('c', 'C', T0);
    hurt(w, 'a', 'b', 9999, T0 + MATCH_MS - 1000);
    w.tick(T0 + MATCH_MS + 1);
    expect(b.alive).toBe(false);
    expect(w.phase).toBe('sudden');
    expect(w.requestRespawn('b', 'pistol', T0 + MATCH_MS + 2)).toBe(false);
    run(w, T0 + MATCH_MS + 2, T0 + MATCH_MS + RESPAWN_PICK_MS + 1000);
    expect(b.alive).toBe(false);
  });

  it('bots keep the quick respawn', () => {
    const w = new ArenaWorld();
    w.join('a', 'A', T0); const bot = w.join('arena-bot-1', 'Bot', T0);
    hurt(w, 'a', 'arena-bot-1', 9999, T0 + 100);
    run(w, T0 + 100, T0 + 100 + RESPAWN_MS + STEP);
    expect(bot.alive).toBe(true);
  });
});

describe('health regen', () => {
  it('nothing for 5 s after a hit, then 25 HP/s to full; damage resets the timer', () => {
    const w = new ArenaWorld();
    w.join('a', 'A', T0); const b = w.join('b', 'B', T0);
    run(w, T0, T0 + 200);
    hurt(w, 'a', 'b', 60, T0 + 200);
    expect(b.hp).toBe(MAX_HP - 60);
    run(w, T0 + 200, T0 + 200 + REGEN_DELAY_MS - STEP);
    expect(b.hp).toBe(MAX_HP - 60);
    run(w, T0 + 200 + REGEN_DELAY_MS - STEP, T0 + 200 + REGEN_DELAY_MS + 1000);
    expect(b.hp).toBeGreaterThan(MAX_HP - 60 + REGEN_HPS * 0.8);
    expect(b.hp).toBeLessThan(MAX_HP - 60 + REGEN_HPS * 1.2);
    const t1 = T0 + 200 + REGEN_DELAY_MS + 1000;
    hurt(w, 'a', 'b', 10, t1);
    const hp = b.hp;
    run(w, t1, t1 + REGEN_DELAY_MS - STEP);
    expect(b.hp).toBe(hp); // timer reset
    run(w, t1 + REGEN_DELAY_MS - STEP, t1 + REGEN_DELAY_MS + 10_000);
    expect(b.hp).toBe(MAX_HP);
  });

  it('bots regen too, also in sudden death', () => {
    const w = new ArenaWorld();
    w.join('a', 'A', T0); w.join('c', 'C', T0); const bot = w.join('arena-bot-2', 'Bot', T0);
    w.tick(T0 + MATCH_MS + 1);
    expect(w.phase).toBe('sudden');
    const t = T0 + MATCH_MS + 100;
    hurt(w, 'a', 'arena-bot-2', 50, t);
    run(w, t, t + REGEN_DELAY_MS + 3000);
    expect(bot.hp).toBe(MAX_HP);
  });
});

describe('respawn -> move without being hit', () => {
  it('a respawned human can move right away (server accepts moves, seq reset)', () => {
    const w = new ArenaWorld();
    w.join('a', 'A', T0); const b = w.join('b', 'B', T0);
    w.move('b', b.x, b.y, 0, T0 + 50, 0, false, false, 41);
    hurt(w, 'a', 'b', 9999, T0 + 100);
    expect(w.requestRespawn('b', 'pistol', T0 + 500)).toBe(true);
    w.tick(T0 + 500 + STEP);
    expect(b.alive).toBe(true);
    expect(b.moveSeq).toBeUndefined();
    const x0 = b.x, y0 = b.y, t = T0 + 500 + STEP;
    let moved = false;
    for (let i = 1; i <= 6 && !moved; i++) {
      for (const [dx, dy] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
        w.move('b', x0 + dx * i / 2, y0 + dy * i / 2, 0, t + i * 60, 0, false, false, i);
        if (Math.hypot(b.x - x0, b.y - y0) > 0.05) { moved = true; break; }
      }
    }
    expect(moved).toBe(true);
    expect(b.hp).toBe(MAX_HP); // never hit
  });
});
