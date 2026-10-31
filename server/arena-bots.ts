/**
 * Arena bots: fill in when exactly one human is playing, leave when a second human joins, never run with nobody.
 * They walk a waypoint graph built from the map's own collision (so stairs, ramps and the Office Block mezzanine
 * all work), pick weapons by range, strafe, back off to cover when hurt, and aim with a human-ish reaction delay
 * and wobble so an average player can beat them. Pure: time and randomness come in, events go out.
 */
import {
  canStand, chestOf, tryJump, eyeOf, groundAt, lineOfSight, moveHorizontal, MOVE_SPEED, stepVertical, TICK_HZ, WEAPONS,
  type ArenaMap, type WeaponId,
} from '../shared/fps.js';
import type { ArenaEvent, ArenaFighter, ArenaWorld } from './arena-world.js';

export const ARENA_BOT_PREFIX = 'arena-bot-';
export const ARENA_BOT_COUNT = 3;
export const BOT_NAMES = ['Bot · Viper', 'Bot · Havoc', 'Bot · Rook', 'Bot · Ghost', 'Bot · Mako'];
export const isArenaBot = (id: string) => id.startsWith(ARENA_BOT_PREFIX);
/** Reaction delay before a bot starts shooting someone it just spotted. */
export const BOT_REACTION_MS = 450;

// ---------------------------------------------------------------- nav graph

export interface NavNode { x: number; y: number; z: number; next: number[]; /** neighbours that need a jump (crate steps) */ jump: number[] }
const graphs = new Map<string, NavNode[]>();

/** Standable surface heights at a cell centre: the ground, every solid top and ramp top there. */
function levelsAt(map: ArenaMap, x: number, y: number): number[] {
  const zs = new Set<number>([0]);
  for (const s of map.solids) if (x + 0.3 > s.x0 && x - 0.3 < s.x1 && y + 0.3 > s.y0 && y - 0.3 < s.y1) zs.add(s.z1);
  for (const r of map.ramps) if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) zs.add(groundAt(x, y, 99, { ...map, solids: [] }));
  return [...zs].filter((z) => canStand(x, y, z, map) && Math.abs(groundAt(x, y, z + 0.05, map) - z) < 0.05);
}

/** Can a player walk (or jump-walk) from a to b, frame by frame like a real client? */
function reach(a: NavNode, b: NavNode, jump: boolean, map: ArenaMap): boolean {
  const body = { x: a.x, y: a.y, z: a.z, vz: 0, grounded: true };
  if (jump) tryJump(body);
  const v = MOVE_SPEED / 60;
  for (let t = 0; t < 60; t++) {
    const dx = b.x - body.x, dy = b.y - body.y, d = Math.hypot(dx, dy);
    if (d > 0.02) moveHorizontal(body, (dx / d) * Math.min(v, d), (dy / d) * Math.min(v, d), map);
    stepVertical(body, 1 / 60, map);
    if (d <= 0.02 && body.grounded) break;
  }
  return Math.hypot(body.x - b.x, body.y - b.y) < 0.1 && Math.abs(body.z - b.z) < 0.1 && body.grounded;
}

/** Waypoints on a 1-tile grid, linked where a straight walk (with stepping/falling) really gets there. */
export function navGraph(map: ArenaMap): NavNode[] {
  const hit = graphs.get(map.id);
  if (hit) return hit;
  const S = 1;
  const nodes: NavNode[] = [];
  const cell = new Map<string, number[]>();
  for (let gy = 0; (gy + 0.5) * S < map.d; gy++) for (let gx = 0; (gx + 0.5) * S < map.w; gx++) {
    const x = (gx + 0.5) * S, y = (gy + 0.5) * S;
    const ids: number[] = [];
    for (const z of levelsAt(map, x, y)) { ids.push(nodes.length); nodes.push({ x, y, z, next: [], jump: [] }); }
    cell.set(`${gx},${gy}`, ids);
  }
  for (const [key, ids] of cell) {
    const [gx, gy] = key.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      for (const j of cell.get(`${gx + dx},${gy + dy}`) ?? []) for (const i of ids) {
        const a = nodes[i], b = nodes[j];
        if (reach(a, b, false, map)) a.next.push(j);
        else if (b.z > a.z + 0.3 && reach(a, b, true, map)) { a.next.push(j); a.jump.push(j); }
      }
    }
  }
  graphs.set(map.id, nodes);
  return nodes;
}

export function nearestNode(nodes: NavNode[], x: number, y: number, z: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const d = Math.hypot(n.x - x, n.y - y) + Math.abs(n.z - z) * 3;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Breadth-first path of node indices from a to b (inclusive), or [] if unreachable. */
export function findPath(nodes: NavNode[], a: number, b: number): number[] {
  const prev = new Int32Array(nodes.length).fill(-1);
  prev[a] = a;
  const q = [a];
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (i === b) break;
    for (const j of nodes[i].next) if (prev[j] < 0) { prev[j] = i; q.push(j); }
  }
  if (prev[b] < 0) return [];
  const out = [b];
  while (out[out.length - 1] !== a) out.push(prev[out[out.length - 1]]);
  return out.reverse();
}

// ---------------------------------------------------------------- spawn / despawn rules

/** How many bots should be in the arena for this many humans: 3 with exactly one human, otherwise none. */
export const wantedBots = (humans: number) => (humans === 1 ? ARENA_BOT_COUNT : 0);

interface BotMind { path: number[]; goal: number; strafe: number; strafeUntil: number; target: string | null; seenAt: number; wobble: number; retreat: boolean; leaving: boolean; jumpAt: number; last: number }

export class ArenaBots {
  minds = new Map<string, BotMind>();
  constructor(private rand: () => number = Math.random) {}

  /**
   * Applies the rules: one human → bots join; two or more → bots leave (at their next death, or right away if
   * no one is fighting them); zero humans → all bots leave at once. `isHuman` excludes QA bots and arena bots.
   */
  sync(world: ArenaWorld, now: number, isHuman: (id: string) => boolean): void {
    const humans = [...world.fighters.keys()].filter(isHuman).length;
    const want = wantedBots(humans);
    const mine = [...world.fighters.keys()].filter(isArenaBot);
    if (humans === 0) { for (const id of mine) this.remove(world, id); return; }
    if (mine.length > want) {
      for (const id of mine) {
        const f = world.fighters.get(id)!;
        const m = this.minds.get(id);
        if (m) m.leaving = true;
        // Gone at their next death; ones not in a fight leave straight away.
        if (!f.alive || !m?.target) this.remove(world, id);
      }
      return;
    }
    for (const id of mine) { const m = this.minds.get(id); if (m) m.leaving = false; }
    for (let i = 0; mine.length < want && i < BOT_NAMES.length; i++) {
      const id = `${ARENA_BOT_PREFIX}${i + 1}`;
      if (world.fighters.has(id)) continue;
      const f = world.join(id, BOT_NAMES[i], now);
      f.weapon = (['smg', 'pistol', 'shotgun', 'smg', 'sniper'] as WeaponId[])[i];
      this.minds.set(id, { path: [], goal: -1, strafe: 1, strafeUntil: 0, target: null, seenAt: 0, wobble: 0, retreat: false, leaving: false, jumpAt: 0, last: -1 });
      mine.push(id);
    }
  }

  remove(world: ArenaWorld, id: string): void {
    world.leave(id);
    this.minds.delete(id);
  }

  /** One AI step per server tick for every bot. Returns the events their actions caused (shots, jumps...). */
  drive(world: ArenaWorld, now: number): ArenaEvent[] {
    const out: ArenaEvent[] = [];
    const nodes = navGraph(world.map);
    for (const [id, m] of this.minds) {
      const f = world.fighters.get(id);
      if (!f) { this.minds.delete(id); continue; }
      if (!f.alive) {
        m.path = []; m.target = null;
        if (m.leaving) this.remove(world, id);
        continue;
      }
      // Vision: nearest living enemy in line of sight within 30 tiles.
      let foe: ArenaFighter | null = null, fd = 30;
      for (const t of world.fighters.values()) {
        if (t.id === id || !t.alive || isArenaBot(t.id)) continue; // bots hunt humans (and QA bots), not each other
        const d = Math.hypot(t.x - f.x, t.y - f.y, t.z - f.z);
        if (d < fd && lineOfSight(eyeOf(f), chestOf(t), world.map)) { foe = t; fd = d; }
      }
      if (foe && m.target !== foe.id) { m.target = foe.id; m.seenAt = now; m.wobble = (this.rand() - 0.5) * 0.25; }
      if (!foe) m.target = null;
      m.retreat = f.hp < 35 && !!foe;
      // Weapon by range.
      const w: WeaponId = foe ? (fd < 3.3 ? 'knife' : fd < 5 ? 'shotgun' : fd > 18 ? 'sniper' : f.id.endsWith('2') ? 'pistol' : 'smg') : f.weapon;
      if (w !== f.weapon && now - f.switchedAt > (w === 'knife' ? 600 : 2500)) world.switchWeapon(id, w, now);
      if (f.ammo[f.weapon] === 0) world.reload(id, now);
      // Movement: follow the path to a goal (a random node, or toward the foe), strafing in fights.
      const here = nearestNode(nodes, f.x, f.y, f.z);
      if (!m.path.length || (foe && now % 2000 < 70)) {
        let goal = Math.floor(this.rand() * nodes.length);
        if (foe && !m.retreat) goal = nearestNode(nodes, foe.x, foe.y, foe.z);
        if (m.retreat && foe) {
          // Cover-ish: a nearby node the foe can't see.
          for (let k = 0; k < 25; k++) {
            const c = Math.floor(this.rand() * nodes.length);
            const n = nodes[c];
            if (Math.hypot(n.x - f.x, n.y - f.y) < 10 && !lineOfSight({ x: n.x, y: n.y, z: n.z + 1.5 }, chestOf(foe), world.map)) { goal = c; break; }
          }
        }
        m.goal = goal;
        m.path = findPath(nodes, here, goal).slice(1);
        m.last = here;
      }
      const step = (MOVE_SPEED * 0.85) / TICK_HZ;
      let dx = 0, dy = 0;
      if (m.path.length) {
        const n = nodes[m.path[0]];
        const d = Math.hypot(n.x - f.x, n.y - f.y);
        if (d < 0.35) m.last = m.path.shift()!;
        else if (f.grounded && m.last >= 0 && nodes[m.last]?.jump.includes(m.path[0]) && d < 1.2) out.push(...world.jump(id, now));
        else { dx = ((n.x - f.x) / d) * step; dy = ((n.y - f.y) / d) * step; }
      }
      let face = Math.atan2(dy, dx);
      if (foe) {
        if (now > m.strafeUntil) { m.strafe = this.rand() < 0.5 ? -1 : 1; m.strafeUntil = now + 500 + this.rand() * 900; }
        const toFoe = Math.atan2(foe.y - f.y, foe.x - f.x);
        const keep = fd < 4 && !m.retreat ? 0 : 0.6;
        dx = dx * keep + Math.cos(toFoe + (Math.PI / 2) * m.strafe) * step * 0.6;
        dy = dy * keep + Math.sin(toFoe + (Math.PI / 2) * m.strafe) * step * 0.6;
        face = toFoe;
        if (now - m.jumpAt > 3000 && this.rand() < 0.03) { m.jumpAt = now; out.push(...world.jump(id, now)); }
      }
      world.move(id, f.x + dx, f.y + dy, face, now, 0);
      if (foe && now - m.seenAt >= BOT_REACTION_MS) {
        // Aim at the chest with a slow wobble and range-based error, so they miss a fair amount.
        const e = eyeOf(f), c = chestOf(foe);
        const err = 0.04 + fd * 0.004;
        const a = Math.atan2(c.y - e.y, c.x - e.x) + m.wobble * Math.sin(now / 300) * 0.4 + (this.rand() - 0.5) * err * 2;
        const p = Math.atan2(c.z - e.z, Math.hypot(c.x - e.x, c.y - e.y)) + (this.rand() - 0.5) * err;
        // Don't hold the trigger like a machine: short bursts.
        if (this.rand() < (f.weapon === 'smg' ? 0.7 : 0.45)) out.push(...world.shoot(id, a, now, p));
      }
    }
    return out;
  }
}

/** For tests: the spec ranges bots use, kept beside WEAPONS for reference. */
export const BOT_WEAPONS = Object.keys(WEAPONS) as WeaponId[];

/** Builds every map's nav graph in the background at startup so the first bot tick doesn't stall the server. */
export function warmNavGraphs(maps: ArenaMap[]): void {
  let i = 0;
  const next = () => { if (i < maps.length) { navGraph(maps[i++]); setTimeout(next, 50).unref?.(); } };
  setTimeout(next, 1000).unref?.();
}
