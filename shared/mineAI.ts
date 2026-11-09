/**
 * Mine creature AI (Nov 4, monster AI pass). A pure, deterministic state machine the server runs every tick
 * (server/mines.ts) and the tests drive directly. Balance rule: HOW HARD a creature hits is decided only by its stat
 * tier (MOBS in mineCombat.ts + AI_TIERS here: damage, cadence, telegraph time, attack type), so every mine is equally
 * dangerous at the same depth. A creature's model only picks a movement flavour (flank / swoop / hop / direct), which
 * changes how it gets to you, never how much it hurts.
 *
 * States: idle -> (wander) -> chase (range + line of sight) -> windup (telegraph, dodgeable) -> strike/dash -> recover
 * -> chase ... ; leash (walk home, heal) when dragged too far from home or the target is lost; stagger when hit.
 */
import { MOBS, MOB_AGGRO, MOB_REACH, SAFE_X, type MobKind, type MobModel } from './mineCombat.js';
import type { CaveId } from './mines.js';

export type AIState = 'idle' | 'wander' | 'chase' | 'windup' | 'dash' | 'recover' | 'leash' | 'stagger';
export type AttackType = 'melee' | 'charge' | 'shot' | 'slam';
export type MoveStyle = 'direct' | 'flank' | 'swoop' | 'hop' | 'kite' | 'heavy';
export type BossMove = 'slam' | 'summon' | 'charge' | 'barrage';
export interface AITier { attack: AttackType; windupMs: number; recoverMs: number; range: number; leash: number; aggro: number }
/** Per stat tier, identical in every mine. range = distance at which it starts its wind-up. */
export const AI_TIERS: Record<MobKind, AITier> = {
  slime:  { attack: 'melee',  windupMs: 450, recoverMs: 500, range: MOB_REACH,       leash: 14, aggro: MOB_AGGRO * 0.8 },
  bat:    { attack: 'melee',  windupMs: 380, recoverMs: 450, range: MOB_REACH,       leash: 16, aggro: MOB_AGGRO },
  crab:   { attack: 'charge', windupMs: 650, recoverMs: 700, range: 5.5,             leash: 16, aggro: MOB_AGGRO },
  golem:  { attack: 'slam',   windupMs: 950, recoverMs: 800, range: MOB_REACH + 0.6, leash: 13, aggro: MOB_AGGRO * 0.9 },
  wraith: { attack: 'shot',   windupMs: 600, recoverMs: 500, range: 6.5,             leash: 18, aggro: MOB_AGGRO * 1.2 },
  boss:   { attack: 'slam',   windupMs: 850, recoverMs: 700, range: MOB_REACH + 0.9, leash: 20, aggro: MOB_AGGRO * 1.3 },
};
/** Movement flavour per model (looks only; see header). Tier attack types still apply: wraith-tier always shoots. */
export const MODEL_MOVE: Record<MobModel, MoveStyle> = {
  blob: 'hop', jelly: 'hop', slug: 'hop', bat: 'swoop', elemental: 'swoop', imp: 'swoop', wolf: 'flank', eel: 'flank',
  crab: 'direct', drillbot: 'direct', golem: 'heavy', yeti: 'heavy', kraken: 'heavy', wraith: 'kite', gaswraith: 'kite',
};
export const SLAM_R = 2.2;           // golem-tier ground slam radius
export const BOSS_SLAM_R = 3.2;      // boss special slam radius
export const SHOT_SPEED = 7;         // units/s, slow enough to sidestep
export const SHOT_LIFE_MS = 1600;
export const SHOT_HIT_R = 0.55;
export const DASH_SPEED_X = 3.4;     // charge speed = tier speed * this
export const DASH_MS = 650;
export const DASH_HIT_R = 0.9;
export const KNOCKBACK = 1.1;        // units a hit pushes the player
export const STAGGER_MS = 260;
export const BOSS_STAGGER_MS = 90;
export const MINI_HP = 0.35, MINI_DMG = 0.5, SPLIT_N = 2;
export const LOST_MS = 3000;         // no sight of the target this long -> give up and go home
/** Boss phases by HP fraction, and the specials unlocked per phase (same in every mine; names are themed). */
export const bossPhase = (hp: number, max: number): 1 | 2 | 3 => (hp > max * 0.66 ? 1 : hp > max * 0.33 ? 2 : 3);
export const BOSS_PHASE_MOVES: Record<1 | 2 | 3, BossMove[]> = { 1: ['slam'], 2: ['slam', 'summon'], 3: ['charge', 'barrage', 'slam'] };
export const BOSS_SPECIAL_MS: Record<1 | 2 | 3, number> = { 1: 6500, 2: 5500, 3: 4200 };
export const BOSS_SUMMON_N = 2, BOSS_BARRAGE_N = 5, BOSS_MAX_ADDS = 4;
export const BOSS_MOVE_NAMES: Record<CaveId, Record<BossMove, string>> = {
  mine:   { slam: 'Rockfall Slam', summon: 'Call the Swarm', charge: 'Avalanche Rush', barrage: 'Boulder Barrage' },
  frost:  { slam: 'Glacier Stomp', summon: 'Howl of the Pack', charge: 'Blizzard Charge', barrage: 'Icicle Volley' },
  magma:  { slam: 'Eruption', summon: 'Spawn Cinders', charge: 'Molten Rush', barrage: 'Fireball Rain' },
  coral:  { slam: 'Tidal Slam', summon: 'Brood Release', charge: 'Riptide Lunge', barrage: 'Ink Torpedoes' },
  fortmc: { slam: 'Pile Driver', summon: 'Deploy Drones', charge: 'Full Throttle', barrage: 'Rivet Spray' },
  quarry: { slam: 'Bench Collapse', summon: 'Loose Screes', charge: 'Hauler Rush', barrage: 'Chip Spray' },
};

export interface AIMob {
  id: number; kind: MobKind; x: number; y: number; hx: number; hy: number; hp: number; max: number; dmg: number; a: number;
  st: AIState; stAt: number; stUntil: number; target: string | null; seenAt: number; lastAttack: number;
  /** telegraph: what is coming and where (locked at wind-up start so players can step out of it) */
  tel: { k: AttackType | BossMove; x: number; y: number; r: number; dx: number; dy: number } | null;
  wx: number; wy: number; path: Array<[number, number]>; pathAt: number; side: number; hit: boolean;
  phase: 1 | 2 | 3; specialAt: number; nextMove: BossMove | null; mini?: boolean; adds?: number;
}
export interface AITarget { id: string; x: number; y: number; z: number }
export interface AIEnv {
  canStand: (x: number, y: number) => boolean;
  los: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean;
  rng: () => number;
  model?: MobModel;
}
export type AIEvent =
  | { t: 'hit'; target: string; dmg: number; kx: number; ky: number; by: number }
  | { t: 'shot'; x: number; y: number; vx: number; vy: number; dmg: number; by: number }
  | { t: 'aoe'; x: number; y: number; r: number; dmg: number; by: number }
  | { t: 'summon'; n: number; by: number }
  | { t: 'phase'; phase: 2 | 3; by: number };

export function newAI(id: number, kind: MobKind, x: number, y: number, hp: number, dmg: number): AIMob {
  return { id, kind, x, y, hx: x, hy: y, hp, max: hp, dmg, a: 0, st: 'idle', stAt: 0, stUntil: 0, target: null, seenAt: 0, lastAttack: 0,
    tel: null, wx: x, wy: y, path: [], pathAt: 0, side: id % 2 ? 1 : -1, hit: false, phase: 1, specialAt: 0, nextMove: null };
}
const setSt = (m: AIMob, st: AIState, now: number, ms = 0) => { m.st = st; m.stAt = now; m.stUntil = ms ? now + ms : 0; };

/** Grid BFS (1-unit cells, 8-way, no corner cutting) from a to b; returns waypoints (cell centres) or [] if unreachable. */
export function findPath(ax: number, ay: number, bx: number, by: number, canStand: (x: number, y: number) => boolean, maxR = 22): Array<[number, number]> {
  const sx = Math.floor(ax), sy = Math.floor(ay), gx = Math.floor(bx), gy = Math.floor(by);
  if (sx === gx && sy === gy) return [[bx, by]];
  const key = (x: number, y: number) => (x + 512) * 4096 + (y + 512);
  const prev = new Map<number, number>(); prev.set(key(sx, sy), -1);
  const q: Array<[number, number]> = [[sx, sy]]; let found = false;
  const ok = (x: number, y: number) => Math.abs(x - sx) <= maxR && Math.abs(y - sy) <= maxR && x + 0.5 >= SAFE_X && canStand(x + 0.5, y + 0.5);
  for (let qi = 0; qi < q.length && qi < 4000; qi++) {
    const [x, y] = q[qi];
    if (x === gx && y === gy) { found = true; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny); if (prev.has(k)) continue;
      if (!ok(nx, ny) && !(nx === gx && ny === gy)) continue;
      if (dx && dy && (!ok(x + dx, y) || !ok(x, y + dy))) continue;
      prev.set(k, key(x, y)); q.push([nx, ny]);
    }
  }
  if (!found) return [];
  const out: Array<[number, number]> = []; let k = key(gx, gy);
  while (k !== key(sx, sy) && k !== -1) { const x = Math.floor(k / 4096) - 512, y = (k % 4096) - 512; out.unshift([x + 0.5, y + 0.5]); k = prev.get(k)!; }
  out[out.length - 1] = [bx, by];
  return out;
}

/** Move toward (gx,gy): straight when clear, otherwise along a BFS path around rock (re-planned every 500 ms). */
function moveTo(m: AIMob, gx: number, gy: number, speed: number, dt: number, now: number, env: AIEnv): void {
  let tx = gx, ty = gy;
  const direct = env.los(m.x, m.y, 0.5, gx, gy, 0.5);
  if (!direct) {
    if (now - m.pathAt > 500 || !m.path.length) { m.path = findPath(m.x, m.y, gx, gy, env.canStand); m.pathAt = now; }
    while (m.path.length > 1 && Math.hypot(m.path[0][0] - m.x, m.path[0][1] - m.y) < 0.35) m.path.shift();
    if (m.path.length) [tx, ty] = m.path[0];
  } else m.path = [];
  const d = Math.hypot(tx - m.x, ty - m.y); if (d < 1e-3) return;
  const step = Math.min(d, speed * dt); const ux = (tx - m.x) / d, uy = (ty - m.y) / d;
  const nx = m.x + ux * step, ny = m.y + uy * step;
  if (nx >= SAFE_X && env.canStand(nx, m.y)) m.x = nx;
  if (env.canStand(m.x, ny)) m.y = ny;
}

/** Where this creature wants to stand relative to its target, per movement flavour. */
function chaseGoal(m: AIMob, t: AITarget, style: MoveStyle, now: number, tier: AITier): [number, number] {
  const dx = m.x - t.x, dy = m.y - t.y, d = Math.hypot(dx, dy) || 1;
  if (tier.attack === 'shot' || style === 'kite') { // hold at ~70% of range, strafe sideways
    const want = tier.attack === 'shot' ? tier.range * 0.7 : 1; const ang = Math.atan2(dy, dx) + m.side * 0.35;
    return [t.x + Math.cos(ang) * want, t.y + Math.sin(ang) * want];
  }
  if (style === 'flank' && d > 2.2) { // circle to the target's side before closing in
    const ang = Math.atan2(dy, dx) + m.side * 1.1; return [t.x + Math.cos(ang) * 1.8, t.y + Math.sin(ang) * 1.8];
  }
  if (style === 'swoop') { // erratic weave
    const w = Math.sin(now / 260 + m.id * 1.7) * Math.min(1.6, d * 0.4); const px = -dy / d, py = dx / d;
    return [t.x + px * w, t.y + py * w];
  }
  return [t.x, t.y];
}
const speedMul = (style: MoveStyle, now: number, m: AIMob) =>
  style === 'hop' ? (Math.sin(now / 180 + m.id) > 0 ? 1.7 : 0.15) : style === 'heavy' ? 0.85 : style === 'swoop' ? 1.1 : 1;

/** Pick who to chase: nearest visible target within aggro range. */
export function detect(m: AIMob, targets: AITarget[], env: AIEnv, range = AI_TIERS[m.kind].aggro): AITarget | null {
  let best: AITarget | null = null; let bd = range; const z = MOBS[m.kind].z;
  for (const t of targets) {
    if (t.x < SAFE_X) continue;
    const d = Math.hypot(t.x - m.x, t.y - m.y);
    if (d < bd && env.los(m.x, m.y, z, t.x, t.y, t.z + 1)) { best = t; bd = d; }
  }
  return best;
}

/** Called by the server when a player's hit lands: brief stagger (bosses barely flinch and keep their wind-up). */
export function onHurt(m: AIMob, now: number, by: string | null): void {
  if (m.kind === 'boss') { if (m.st !== 'windup' && m.st !== 'dash') setSt(m, 'stagger', now, BOSS_STAGGER_MS); }
  else { m.tel = null; setSt(m, 'stagger', now, STAGGER_MS); }
  if (by && !m.target) m.target = by;
  m.seenAt = now;
}

/** Start an attack: lock the telegraph at the target's current spot. */
function startWindup(m: AIMob, t: AITarget, now: number, k: AttackType | BossMove): void {
  const dx = t.x - m.x, dy = t.y - m.y, d = Math.hypot(dx, dy) || 1; const tier = AI_TIERS[m.kind];
  const r = k === 'slam' ? (m.kind === 'boss' && m.nextMove ? BOSS_SLAM_R : SLAM_R) : k === 'melee' ? MOB_REACH + 0.2 : k === 'charge' ? DASH_HIT_R : SHOT_HIT_R;
  const at: [number, number] = k === 'slam' ? (m.kind === 'boss' ? [m.x, m.y] : [m.x + (dx / d) * Math.min(d, 1), m.y + (dy / d) * Math.min(d, 1)]) : [t.x, t.y];
  m.tel = { k, x: at[0], y: at[1], r, dx: dx / d, dy: dy / d };
  m.a = Math.atan2(dy, dx);
  const ms = k === 'summon' ? 700 : k === 'barrage' ? 900 : tier.windupMs;
  setSt(m, 'windup', now, ms);
}

/** Resolve a finished wind-up against where targets are NOW (stepping out of the marker dodges it). */
function resolve(m: AIMob, targets: AITarget[], now: number, ev: AIEvent[]): void {
  const tel = m.tel!; const dmg = m.dmg; const tier = AI_TIERS[m.kind];
  const push = (t: AITarget, k = KNOCKBACK) => { const dx = t.x - m.x, dy = t.y - m.y, d = Math.hypot(dx, dy) || 1; return { kx: (dx / d) * k, ky: (dy / d) * k }; };
  switch (tel.k) {
    case 'melee': for (const t of targets) if (t.id === m.target && Math.hypot(t.x - m.x, t.y - m.y) <= tel.r) ev.push({ t: 'hit', target: t.id, dmg, ...push(t, KNOCKBACK * 0.6), by: m.id }); break;
    case 'slam': ev.push({ t: 'aoe', x: tel.x, y: tel.y, r: tel.r, dmg, by: m.id });
      for (const t of targets) if (Math.hypot(t.x - tel.x, t.y - tel.y) <= tel.r) ev.push({ t: 'hit', target: t.id, dmg, ...push(t, KNOCKBACK * 1.4), by: m.id }); break;
    case 'charge': m.hit = false; setSt(m, 'dash', now, DASH_MS); m.lastAttack = now; return;
    case 'shot': ev.push({ t: 'shot', x: m.x, y: m.y, vx: tel.dx * SHOT_SPEED, vy: tel.dy * SHOT_SPEED, dmg, by: m.id }); break;
    case 'barrage': for (let i = 0; i < BOSS_BARRAGE_N; i++) { const a = Math.atan2(tel.dy, tel.dx) + (i - (BOSS_BARRAGE_N - 1) / 2) * 0.28; ev.push({ t: 'shot', x: m.x, y: m.y, vx: Math.cos(a) * SHOT_SPEED, vy: Math.sin(a) * SHOT_SPEED, dmg: Math.round(dmg * 0.6), by: m.id }); } break;
    case 'summon': ev.push({ t: 'summon', n: BOSS_SUMMON_N, by: m.id }); break;
  }
  m.lastAttack = now; m.tel = null; m.nextMove = null; setSt(m, 'recover', now, tier.recoverMs);
}

/** One AI tick. Mutates m; returns events for the server to apply (damage, projectiles, AoE fx, summons, phase). */
export function stepAI(m: AIMob, targets: AITarget[], now: number, dt: number, env: AIEnv): AIEvent[] {
  const ev: AIEvent[] = []; const def = MOBS[m.kind]; const tier = AI_TIERS[m.kind]; const style = MODEL_MOVE[env.model ?? 'blob'] ?? 'direct';
  if (m.kind === 'boss') { const ph = bossPhase(m.hp, m.max); if (ph > m.phase) { m.phase = ph; ev.push({ t: 'phase', phase: ph as 2 | 3, by: m.id }); m.specialAt = 0; } }
  const home = Math.hypot(m.x - m.hx, m.y - m.hy);
  const tgt = m.target ? targets.find((t) => t.id === m.target && t.x >= SAFE_X) ?? null : null;
  if (m.stUntil && now < m.stUntil && (m.st === 'stagger' || m.st === 'recover')) return ev;
  switch (m.st) {
    case 'stagger': case 'recover': setSt(m, tgt ? 'chase' : 'idle', now); return ev;
    case 'windup':
      if (now >= m.stUntil) resolve(m, targets, now, ev);
      return ev;
    case 'dash': {
      const sp = def.speed * DASH_SPEED_X * dt; const nx = m.x + m.tel!.dx * sp, ny = m.y + m.tel!.dy * sp;
      const blocked = !(nx >= SAFE_X && env.canStand(nx, ny));
      if (!blocked) { m.x = nx; m.y = ny; }
      if (!m.hit) for (const t of targets) if (Math.hypot(t.x - m.x, t.y - m.y) <= DASH_HIT_R) { m.hit = true; ev.push({ t: 'hit', target: t.id, dmg: m.dmg, kx: m.tel!.dx * KNOCKBACK * 1.6, ky: m.tel!.dy * KNOCKBACK * 1.6, by: m.id }); break; }
      if (blocked || now >= m.stUntil || m.hit) { m.tel = null; setSt(m, 'recover', now, tier.recoverMs + (blocked ? 400 : 0)); }
      return ev;
    }
    case 'leash':
      m.target = null;
      if (home < 0.6) { m.hp = m.max; m.path = []; setSt(m, 'idle', now); return ev; }
      m.hp = Math.min(m.max, m.hp + m.max * 0.25 * dt);
      moveTo(m, m.hx, m.hy, def.speed * 1.3, dt, now, env); m.a = Math.atan2(m.hy - m.y, m.hx - m.x);
      return ev;
    case 'idle': case 'wander': {
      const seen = detect(m, targets, env);
      if (seen) { m.target = seen.id; m.seenAt = now; setSt(m, 'chase', now); return ev; }
      if (m.st === 'idle') {
        if (now - m.stAt > 1500 + (m.id % 5) * 400) {
          const a = env.rng() * Math.PI * 2, r = 1 + env.rng() * 2.5; const wx = m.hx + Math.cos(a) * r, wy = m.hy + Math.sin(a) * r;
          if (wx >= SAFE_X && env.canStand(wx, wy)) { m.wx = wx; m.wy = wy; setSt(m, 'wander', now, 4000); } else m.stAt = now;
        }
      } else {
        moveTo(m, m.wx, m.wy, def.speed * 0.45, dt, now, env); m.a = Math.atan2(m.wy - m.y, m.wx - m.x);
        if (Math.hypot(m.wx - m.x, m.wy - m.y) < 0.3 || now >= m.stUntil) setSt(m, 'idle', now);
      }
      return ev;
    }
    case 'chase': {
      if (!tgt) { m.target = null; setSt(m, 'leash', now); return ev; }
      const d = Math.hypot(tgt.x - m.x, tgt.y - m.y);
      const sees = d < tier.aggro * 1.5 && env.los(m.x, m.y, def.z, tgt.x, tgt.y, tgt.z + 1);
      if (sees) m.seenAt = now;
      if (home > tier.leash || now - m.seenAt > LOST_MS) { m.tel = null; m.target = null; setSt(m, 'leash', now); return ev; }
      m.a = Math.atan2(tgt.y - m.y, tgt.x - m.x);
      // boss specials
      if (m.kind === 'boss' && sees) {
        if (!m.specialAt) m.specialAt = now + 2500;
        if (now >= m.specialAt) {
          const moves = BOSS_PHASE_MOVES[m.phase].filter((k) => k !== 'summon' || (m.adds ?? 0) < BOSS_MAX_ADDS);
          const k = moves[Math.floor(env.rng() * moves.length)] ?? 'slam'; m.nextMove = k; m.specialAt = now + BOSS_SPECIAL_MS[m.phase];
          if (k === 'charge' || k === 'barrage' || k === 'summon' || d <= BOSS_SLAM_R) { startWindup(m, tgt, now, k); m.nextMove = null; return ev; }
        }
      }
      const cd = now - m.lastAttack >= def.attackMs;
      const inRange = tier.attack === 'charge' ? d <= tier.range && d >= 1.6 && sees : d <= tier.range && (tier.attack !== 'shot' || sees);
      const closeMelee = tier.attack === 'charge' && d <= MOB_REACH; // charger at point-blank just bites
      if (cd && (inRange || closeMelee)) { startWindup(m, tgt, now, closeMelee ? 'melee' : tier.attack); return ev; }
      const [gx, gy] = chaseGoal(m, tgt, style, now, tier);
      if (tier.attack === 'shot' || Math.hypot(gx - m.x, gy - m.y) > MOB_REACH * 0.7) moveTo(m, gx, gy, def.speed * speedMul(style, now, m), dt, now, env);
      return ev;
    }
  }
  return ev;
}

/** Short wire codes for the client (mobsView). */
export const ST_CODE: Record<AIState, number> = { idle: 0, wander: 1, chase: 2, windup: 3, dash: 4, recover: 5, leash: 6, stagger: 7 };
