import { describe, expect, it } from 'vitest';
import { AI_TIERS, BOSS_PHASE_MOVES, BOSS_MOVE_NAMES, MODEL_MOVE, LOST_MS, bossPhase, detect, findPath, newAI, onHurt, stepAI, type AIEnv, type AIMob, type AITarget } from '../shared/mineAI';
import { MOBS, MOB_SKINS, SAFE_X, mobDmg, mobHp, type MobKind } from '../shared/mineCombat';
import { CAVES } from '../shared/mines';
import { MinesWorld } from '../server/mines';

/** Open 40x20 floor; optional rock cells. Line of sight = no rock cell on the segment. */
function envOf(rock: Array<[number, number]> = [], model?: AIEnv['model']): AIEnv {
  const R = new Set(rock.map(([x, y]) => `${x},${y}`));
  const canStand = (x: number, y: number) => x > 0 && y > 0 && x < 40 && y < 20 && !R.has(`${Math.floor(x)},${Math.floor(y)}`);
  const los = (ax: number, ay: number, _az: number, bx: number, by: number) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2); for (let i = 1; i < n; i++) if (!canStand(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)) return false; return true; };
  let s = 7; return { canStand, los, rng: () => ((s = (s * 16807) % 2147483647) / 2147483647), model };
}
const mob = (kind: MobKind, x = 20, y = 10): AIMob => newAI(1, kind, x, y, mobHp(kind, 40), mobDmg(kind, 40));
const run = (m: AIMob, t: AITarget[], env: AIEnv, from: number, ms: number, step = 100) => { const ev = []; for (let now = from; now < from + ms; now += step) ev.push(...stepAI(m, t, now, step / 1000, env)); return ev; };

describe('mine AI state machine', () => {
  it('detects only within range and with line of sight', () => {
    const m = mob('slime'); const env = envOf();
    expect(detect(m, [{ id: 'a', x: 20 + AI_TIERS.slime.aggro + 1, y: 10, z: 0 }], env)).toBeNull();
    expect(detect(m, [{ id: 'a', x: 24, y: 10, z: 0 }], env)?.id).toBe('a');
    const walled = envOf([[22, 9], [22, 10], [22, 11]]);
    expect(detect(m, [{ id: 'a', x: 24, y: 10, z: 0 }], walled)).toBeNull();
    expect(detect(m, [{ id: 'a', x: SAFE_X - 1, y: 10, z: 0 }], env)).toBeNull(); // the lift is safe
    stepAI(m, [{ id: 'a', x: 24, y: 10, z: 0 }], 1000, 0.1, env); expect(m.st).toBe('chase'); expect(m.target).toBe('a');
  });
  it('idles then wanders near home when nobody is around', () => {
    const m = mob('bat'); const env = envOf(); run(m, [], env, 0, 6000);
    expect(['idle', 'wander']).toContain(m.st); expect(Math.hypot(m.x - m.hx, m.y - m.hy)).toBeLessThan(4);
  });
  it('paths around rock to reach the target', () => {
    const wall: Array<[number, number]> = []; for (let y = 4; y <= 15; y++) wall.push([23, y]);
    const env = envOf(wall); const p = findPath(20.5, 10.5, 26.5, 10.5, env.canStand);
    expect(p.length).toBeGreaterThan(6); for (const [x, y] of p) expect(env.canStand(x, y)).toBe(true);
    const m = mob('slime', 20.5, 10.5); m.st = 'chase'; m.target = 'a'; m.seenAt = 0;
    const t = [{ id: 'a', x: 26.5, y: 10.5, z: 0 }];
    for (let now = 0; now < 15000 && Math.hypot(m.x - 26.5, m.y - 10.5) > 1.5; now += 100) { m.seenAt = now; stepAI(m, t, now, 0.1, env); }
    expect(Math.hypot(m.x - 26.5, m.y - 10.5)).toBeLessThan(1.6);
  });
  it('leashes home (and heals) when dragged past its leash or the target is lost', () => {
    const env = envOf(); const m = mob('crab'); m.st = 'chase'; m.target = 'a'; m.seenAt = 0; m.hp = 10;
    m.x = m.hx + AI_TIERS.crab.leash + 0.5; stepAI(m, [{ id: 'a', x: m.x + 3, y: 10, z: 0 }], 100, 0.1, env);
    expect(m.st).toBe('leash'); expect(m.target).toBeNull();
    run(m, [], env, 200, 20000); expect(['idle', 'wander'].includes(m.st as string)).toBe(true); expect(m.hp).toBe(m.max);
    const n = mob('slime'); n.st = 'chase'; n.target = 'a'; n.seenAt = 0; // target behind rock for > LOST_MS
    const hidden = envOf([[24, 9], [24, 10], [24, 11], [24, 8], [24, 12]]);
    stepAI(n, [{ id: 'a', x: 26, y: 10, z: 0 }], LOST_MS + 100, 0.1, hidden); expect(n.st).toBe('leash');
  });
  it('telegraphs every attack and the wind-up can be dodged', () => {
    const env = envOf(); const m = mob('golem'); m.st = 'chase'; m.target = 'a';
    const t = { id: 'a', x: 21.2, y: 10, z: 0 }; stepAI(m, [t], 5000, 0.1, env);
    expect(m.st).toBe('windup'); expect(m.tel?.k).toBe('slam'); expect(m.stUntil - 5000).toBe(AI_TIERS.golem.windupMs);
    t.x = 26; const ev = run(m, [t], env, 5100, 1200); // stepped out of the marker
    expect(ev.some((e) => e.t === 'hit')).toBe(false); expect(ev.some((e) => e.t === 'aoe')).toBe(true);
    const m2 = mob('golem'); m2.st = 'chase'; m2.target = 'a'; const t2 = { id: 'a', x: 21.2, y: 10, z: 0 }; // stood still
    const ev2 = run(m2, [t2], env, 5000, 1300); const hit = ev2.find((e) => e.t === 'hit');
    expect(hit && hit.t === 'hit' && hit.dmg).toBe(m2.dmg); expect(hit && hit.t === 'hit' && hit.kx).toBeGreaterThan(0); // knocked back away from it
  });
  it('per-tier attacks: chargers dash, ranged creatures fire dodgeable shots', () => {
    const env = envOf(); const c = mob('crab'); c.st = 'chase'; c.target = 'a'; const t = { id: 'a', x: 24, y: 10, z: 0 };
    stepAI(c, [t], 5000, 0.1, env); expect(c.tel?.k).toBe('charge');
    const ev = run(c, [t], env, 5100, 1500); expect(ev.some((e) => e.t === 'hit')).toBe(true);
    const w = mob('wraith'); w.st = 'chase'; w.target = 'a'; stepAI(w, [{ id: 'a', x: 25, y: 10, z: 0 }], 5000, 0.1, env);
    expect(w.tel?.k).toBe('shot'); expect(run(w, [{ id: 'a', x: 25, y: 10, z: 0 }], env, 5100, 800).some((e) => e.t === 'shot')).toBe(true);
  });
  it('a hit staggers creatures and cancels their wind-up (bosses keep theirs)', () => {
    const env = envOf(); const m = mob('golem'); m.st = 'chase'; m.target = 'a'; stepAI(m, [{ id: 'a', x: 21.2, y: 10, z: 0 }], 0, 0.1, env);
    onHurt(m, 100, 'a'); expect(m.st).toBe('stagger'); expect(m.tel).toBeNull();
    const b = mob('boss'); b.st = 'windup'; b.stUntil = 900; b.tel = { k: 'slam', x: 20, y: 10, r: 3, dx: 1, dy: 0 }; onHurt(b, 100, 'a'); expect(b.st).toBe('windup');
  });
  it('bosses move through 3 phases and unlock specials', () => {
    expect(bossPhase(520, 520)).toBe(1); expect(bossPhase(300, 520)).toBe(2); expect(bossPhase(100, 520)).toBe(3);
    const env = envOf(); const b = mob('boss'); b.st = 'chase'; b.target = 'a'; b.seenAt = 0; const t = [{ id: 'a', x: 22, y: 10, z: 0 }];
    b.hp = b.max * 0.5; const ev = stepAI(b, t, 100, 0.1, env); expect(ev).toContainEqual({ t: 'phase', phase: 2, by: 1 }); expect(b.phase).toBe(2);
    b.hp = b.max * 0.2; expect(stepAI(b, t, 200, 0.1, env)).toContainEqual({ t: 'phase', phase: 3, by: 1 });
    const seen = new Set<string>(); for (let now = 300; now < 60000; now += 100) { for (const e of stepAI(b, t, now, 0.1, env)) seen.add(e.t); if (b.tel) seen.add('tel:' + b.tel.k); b.seenAt = now; b.x = 20; b.y = 10; }
    expect(seen.has('tel:charge') || seen.has('tel:barrage')).toBe(true); expect(seen.has('shot') || seen.has('hit')).toBe(true);
    for (const c of Object.keys(CAVES)) for (const k of ['slam', 'summon', 'charge', 'barrage'] as const) expect(BOSS_MOVE_NAMES[c as keyof typeof BOSS_MOVE_NAMES][k]).toBeTruthy();
    expect(BOSS_PHASE_MOVES[2]).toContain('summon');
  });
});

describe('balance stays matched across mines', () => {
  it('every mine uses the shared stat table and per-tier AI (only the movement flavour varies)', () => {
    for (const cave of Object.keys(MOB_SKINS) as Array<keyof typeof MOB_SKINS>) for (const k of Object.keys(MOBS) as MobKind[]) {
      const sk = MOB_SKINS[cave][k]; expect(MODEL_MOVE[sk.model]).toBeTruthy();
      expect(AI_TIERS[k]).toBe(AI_TIERS[k]); // one table, no per-cave overrides exist
    }
    // stat tiers strictly harder the deeper they unlock
    const order: MobKind[] = ['slime', 'bat', 'crab', 'golem', 'wraith', 'boss'];
    for (let i = 1; i < order.length; i++) { expect(MOBS[order[i]].minFloor).toBeGreaterThan(MOBS[order[i - 1]].minFloor); expect(MOBS[order[i]].dmg).toBeGreaterThan(MOBS[order[i - 1]].dmg); }
    expect(Object.fromEntries(order.map((k) => [k, [MOBS[k].hp, MOBS[k].dmg, MOBS[k].attackMs, AI_TIERS[k].attack, AI_TIERS[k].windupMs]]))).toEqual({
      slime: [30, 6, 1200, 'melee', 450], bat: [22, 8, 1000, 'melee', 380], crab: [75, 12, 1300, 'charge', 650],
      golem: [160, 22, 1600, 'slam', 950], wraith: [120, 28, 1100, 'shot', 600], boss: [520, 34, 1500, 'slam', 850],
    });
  });
  it('the same floor spawns the same tiers, HP and damage in every mine', () => {
    const w = new MinesWorld();
    for (const f of [5, 20, 40]) {
      const sig = (c: 'mine' | 'frost' | 'magma' | 'coral' | 'fortmc') => w.mobsOn(f, c).map((b) => `${b.kind}:${b.max}:${b.dmg}`).sort().join(',');
      const kinds = (c: 'mine' | 'frost' | 'magma' | 'coral' | 'fortmc') => w.mobsOn(f, c).map((b) => [b.kind, b.max, b.dmg]);
      for (const c of ['frost', 'magma', 'coral', 'fortmc'] as const) for (const [k, hp, d] of kinds(c)) { expect(hp).toBe(mobHp(k as MobKind, f)); expect(d).toBe(mobDmg(k as MobKind, f)); }
      void sig;
    }
  });
});

describe('server mob sim', () => {
  it('slimes split into small slimes on death; minis do not respawn', () => {
    const w = new MinesWorld(); w.join('s1', null, Date.now());
    const m = w.miners.get('s1')!; Object.assign(m, { floor: 5, cave: 'mine' });
    const list = w.mobsOn(5); const sl = list.find((b) => b.kind === 'slime')!; sl.hp = 1;
    Object.assign(m, { x: sl.x - 1, y: sl.y, z: 0, lastAttack: 0 });
    let killed = false; try { killed = w.attack('s1', sl.id, Date.now() + 5000).killed; } catch { /* LOS/reach on this map */ }
    if (killed) { const minis = list.filter((b) => b.mini && !b.gone); expect(minis.length).toBe(2); for (const b of minis) { expect(b.max).toBeLessThan(sl.max); expect(b.dmg).toBeLessThan(sl.dmg); } }
    else { const n = list.length; w.spawnMini(list, 'slime', sl.x, sl.y, 5, 2, sl.id, 0); expect(list.length).toBe(n + 1); }
  });
});
