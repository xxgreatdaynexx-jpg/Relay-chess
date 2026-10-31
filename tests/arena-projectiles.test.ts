import { describe, expect, it } from 'vitest';
import { MAPS } from '../shared/arenaMaps.js';
const ARENA_MAPS = Object.values(MAPS);
import { gridMap, launchRocket, MAX_HP, ROCKET_GRAVITY, ROCKET_SPEED, rocketDamage, stepRocket, WEAPONS } from '../shared/fps.js';
import { ArenaWorld } from '../server/arena-world.js';
import { ArenaBots, findPath, isArenaBot, navGraph, nearestNode, wantedBots } from '../server/arena-bots.js';

const HALL = gridMap(['##############################', '#............................#', '#............................#', '#............................#', '##############################']);

function world() {
  const w = new ArenaWorld(HALL, () => 0.5);
  const a = w.join('a', 'Ann', 0);
  const b = w.join('b', 'Bob', 0);
  Object.assign(a, { x: 2, y: 2, z: 0, a: 0, p: 0 });
  Object.assign(b, { x: 20, y: 2, z: 0, a: Math.PI });
  w.switchWeapon('a', 'rocket', 0);
  return { w, a, b };
}

describe('rocket physics', () => {
  it('launches at ROCKET_SPEED along the aim and drops under light gravity', () => {
    const r = launchRocket(1, { id: 'a', x: 2, y: 2, z: 0, a: 0, p: 0 }, 0);
    expect(Math.hypot(r.vx, r.vy, r.vz)).toBeCloseTo(ROCKET_SPEED, 5);
    const z0 = r.z;
    expect(stepRocket(r, 250, [], HALL)).toBeNull();
    expect(r.x).toBeGreaterThan(2 + ROCKET_SPEED * 0.2);
    expect(r.z).toBeLessThan(z0);
    expect(z0 - r.z).toBeLessThan(ROCKET_GRAVITY * 0.25 * 0.25);
  });
  it('travels over time rather than hitting instantly, then bursts on the target', () => {
    const { w, b } = world();
    const ev = w.shoot('a', 0, 1000, 0);
    expect(ev[0].ev).toBe('fps_shot');
    expect(w.rockets).toHaveLength(1);
    expect(b.hp).toBe(MAX_HP);
    expect(w.snapshot(1000).rockets).toHaveLength(1);
    w.tick(1300); // 18 tiles at 24/s ≈ 0.75 s, not there yet
    expect(b.hp).toBe(MAX_HP);
    const boom = w.tick(1900);
    expect(boom.some((e) => e.ev === 'fps_boom' && e.data.cause === 'rocket')).toBe(true);
    expect(b.alive).toBe(false);
    expect(w.rockets).toHaveLength(0);
  });
  it('explodes on walls and never hits its own shooter directly', () => {
    const { w, a, b } = world();
    b.y = 3; b.x = 2; // out of the way
    w.shoot('a', 0, 1000, 0);
    w.tick(3000);
    expect(w.rockets).toHaveLength(0);
    expect(a.hp).toBe(MAX_HP); // the far wall is way outside splash
  });
});

describe('rocket splash', () => {
  it('full damage on a direct hit, falloff for bystanders, half on the owner', () => {
    const t = [{ id: 'o', x: 3, y: 2, z: 0, alive: true }, { id: 'd', x: 4.5, y: 2, z: 0, alive: true }, { id: 'n', x: 5.5, y: 2, z: 0, alive: true }];
    const dmg = (rocketDamage({ x: 4.5, y: 2, z: 1 }, 'd', 'o', t, HALL));
    expect(dmg.get('d')).toBe(WEAPONS.rocket.damage);
    expect(dmg.get('n')!).toBeGreaterThan(0);
    expect(dmg.get('n')!).toBeLessThan(WEAPONS.rocket.damage);
    expect(dmg.get('o')!).toBeLessThan(WEAPONS.rocket.damage / 2);
  });
});

describe('arena bots: spawn and despawn rules', () => {
  const human = (id: string) => !isArenaBot(id);
  it('wants 3 bots only with exactly one human', () => {
    expect(wantedBots(0)).toBe(0);
    expect(wantedBots(1)).toBe(3);
    expect(wantedBots(2)).toBe(0);
  });
  it('joins with one human, leaves when a second joins, returns when back to one, stops with none', () => {
    const w = new ArenaWorld(ARENA_MAPS[0], () => 0.5);
    const bots = new ArenaBots(() => 0.5);
    const count = () => [...w.fighters.keys()].filter(isArenaBot).length;
    w.join('h1', 'Human', 0);
    bots.sync(w, 0, human);
    expect(count()).toBe(3);
    expect([...w.fighters.values()].filter((f) => isArenaBot(f.id)).every((f) => f.name.startsWith('Bot · '))).toBe(true);
    expect(w.snapshot(0).players.filter((p: { bot?: boolean }) => p.bot)).toHaveLength(3);
    w.join('h2', 'Second', 10);
    bots.sync(w, 10, human); // not in a fight -> they leave at once
    expect(count()).toBe(0);
    w.leave('h2');
    bots.sync(w, 20, human);
    expect(count()).toBe(3);
    w.leave('h1');
    bots.sync(w, 30, human);
    expect(count()).toBe(0);
    expect(bots.minds.size).toBe(0);
  });
  it('a bot mid-fight waits for its next death before leaving', () => {
    const w = new ArenaWorld(ARENA_MAPS[0], () => 0.5);
    const bots = new ArenaBots(() => 0.5);
    w.join('h1', 'Human', 0);
    bots.sync(w, 0, human);
    const id = [...bots.minds.keys()][0];
    bots.minds.get(id)!.target = 'h1';
    w.join('h2', 'Second', 10);
    bots.sync(w, 10, human);
    expect(w.fighters.has(id)).toBe(true);
    w.fighters.get(id)!.alive = false;
    bots.drive(w, 20);
    expect(w.fighters.has(id)).toBe(false);
  });
  it('bots move and fight without crashing over a minute of play', () => {
    const w = new ArenaWorld(ARENA_MAPS[0], Math.random);
    const bots = new ArenaBots();
    w.join('h1', 'Human', 0);
    bots.sync(w, 0, human);
    const start = [...w.fighters.values()].filter((f) => isArenaBot(f.id)).map((f) => [f.x, f.y]);
    for (let t = 0; t < 60_000; t += 66) { bots.sync(w, t, human); bots.drive(w, t); w.tick(t); }
    const end = [...w.fighters.values()].filter((f) => isArenaBot(f.id)).map((f) => [f.x, f.y]);
    expect(end.some((p, i) => Math.hypot(p[0] - start[i][0], p[1] - start[i][1]) > 1)).toBe(true);
  });
});

describe('bot nav graphs', () => {
  for (const map of ARENA_MAPS) {
    it(`${map.name}: every named level is reachable from the first spawn`, () => {
      const g = navGraph(map);
      expect(g.length).toBeGreaterThan(50);
      const s = map.spawns[0];
      const from = nearestNode(g, s[0], s[1], s[2]);
      for (const l of map.levels ?? []) {
        const c = { name: l.name, x: l.at[0], y: l.at[1], z: l.at[2] };
        const to = nearestNode(g, c.x, c.y, c.z);
        expect(Math.abs(g[to].z - c.z), c.name).toBeLessThan(0.6);
        expect(findPath(g, from, to).length, c.name).toBeGreaterThan(0);
      }
    });
  }
});
