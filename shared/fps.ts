/**
 * Pure logic for the shared 3D arena: map collision, movement physics (gravity, jumping, stairs),
 * 3D hitscan with head/body hitboxes, splash and spawns. Used by the client (prediction/rendering)
 * and the server (authoritative simulation).
 *
 * Coordinates: x/y horizontal (tiles ≈ metres), z up. Yaw `a` turns from +x toward +y; pitch `p` is up-positive.
 */
import { DUNES, type ArenaMap, type Ramp, type Solid } from './arenaMaps.js';

export { MAPS, DEFAULT_MAP_ID, mapById, gridMap, type ArenaMap } from './arenaMaps.js';
export const MAP: ArenaMap = DUNES;

export const MAX_HP = 100;
export const DAMAGE = 34;
export const RESPAWN_MS = 2000;
export const SHOT_COOLDOWN_MS = 300;
export const MOVE_SPEED = 4.6; // units per second
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.7;
export const EYE_HEIGHT = 1.52;
/** Body hitbox: a box of this half-width from the feet up to BODY_TOP; head is a sphere above it. */
export const BODY_HALF = 0.34;
export const BODY_TOP = 1.36;
export const HEAD_Z = 1.55;
export const HEAD_R = 0.2;
export const HEADSHOT_MULT = 2;
/** Crouching (hold Ctrl or C): a shorter capsule, lower eye and hitboxes, slower and a little more accurate. */
export const CROUCH_HEIGHT = 1.15;
export const CROUCH_EYE_HEIGHT = 0.98;
export const CROUCH_BODY_TOP = 0.86;
export const CROUCH_HEAD_Z = 1.02;
export const CROUCH_SPEED_MULT = 0.5;
export const CROUCH_SPREAD_MULT = 0.65;
/** How fast the eye moves between standing and crouched heights (metres per second). */
export const CROUCH_LERP_SPEED = 6;
type Crouchy = { crouch?: boolean; sprint?: boolean };
/** Sprint (hold Shift): ~1.5× run speed, forward / diagonal-forward only, never crouched or scoped. */
export const SPRINT_MULT = 1.5;
/** Widest move direction (radians off facing) that still counts as forward: 45° diagonals plus slack. */
export const SPRINT_MAX_ANGLE = (55 * Math.PI) / 180;
/** Sprint-to-fire: the gun comes up this long after the sprint ends before it can shoot. */
export const SPRINT_FIRE_DELAY_MS = 150;
/** Server allows a little network jitter on the sprint-to-fire delay. */
export const SPRINT_FIRE_SLACK_MS = 40;
/** Is a move with this direction (world angle) relative to facing `a` forward enough to sprint? */
export function sprintDirOk(a: number, dx: number, dy: number): boolean {
  if (Math.hypot(dx, dy) < 1e-6) return true; // standing still: no speed gained anyway
  let d = Math.atan2(dy, dx) - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) <= SPRINT_MAX_ANGLE;
}
/** Whether a sprint request is allowed right now. */
export function canSprint(b: Crouchy & { a: number }, dx: number, dy: number, scoped: boolean): boolean {
  return !b.crouch && !scoped && sprintDirOk(b.a, dx, dy);
}
export const heightOf = (b: Crouchy): number => (b.crouch ? CROUCH_HEIGHT : PLAYER_HEIGHT);
export const eyeHeightOf = (b: Crouchy): number => (b.crouch ? CROUCH_EYE_HEIGHT : EYE_HEIGHT);
export const headZOf = (b: Crouchy): number => (b.crouch ? CROUCH_HEAD_Z : HEAD_Z);
export const bodyTopOf = (b: Crouchy): number => (b.crouch ? CROUCH_BODY_TOP : BODY_TOP);
export const speedOf = (b: Crouchy): number => (b.crouch ? MOVE_SPEED * CROUCH_SPEED_MULT : b.sprint ? MOVE_SPEED * SPRINT_MULT : MOVE_SPEED);
/** Highest ledge you can walk up without jumping (stairs). */
export const STEP_HEIGHT = 0.45;
export const GRAVITY = 20;
export const JUMP_SPEED = 7; // apex ≈ 1.22
export const MAX_PITCH = 1.45;
export const MAX_RANGE = 40;
export const TICK_HZ = 15;
/** Below this the fighter is considered out of the world and respawned (should never happen). */
export const KILL_Z = -5;

export const SPAWNS = MAP.spawns;

// ---------------------------------------------------------------- map queries

function rampTop(r: Ramp, x: number, y: number): number {
  const span = r.dir === '+x' || r.dir === '-x' ? r.x1 - r.x0 : r.y1 - r.y0;
  let t = 0;
  if (r.dir === '+x') t = (x - r.x0) / span;
  if (r.dir === '-x') t = (r.x1 - x) / span;
  if (r.dir === '+y') t = (y - r.y0) / span;
  if (r.dir === '-y') t = (r.y1 - y) / span;
  t = Math.min(1, Math.max(0, t));
  return r.zLow + (r.zHigh - r.zLow) * t;
}
const overlapsXY = (s: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number, r: number) =>
  x + r > s.x0 && x - r < s.x1 && y + r > s.y0 && y - r < s.y1;
const inside = (s: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1;

/** Walkable surfaces under a footprint: [top, bottom] spans (boxes) plus ramp tops sampled at the centre. */
function spansAt(map: ArenaMap, x: number, y: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const s of map.solids) if (overlapsXY(s, x, y, r)) out.push([s.z1, s.z0]);
  for (const rp of map.ramps) {
    if (inside(rp, x, y)) out.push([rampTop(rp, x, y), 0]);
    else if (overlapsXY(rp, x, y, r)) {
      // Edge of a ramp: use the height at the nearest point on it.
      const cx = Math.min(rp.x1, Math.max(rp.x0, x)), cy = Math.min(rp.y1, Math.max(rp.y0, y));
      out.push([rampTop(rp, cx, cy), 0]);
    }
  }
  return out;
}

const outOfBounds = (map: ArenaMap, x: number, y: number, r = PLAYER_RADIUS) => x - r < 0 || y - r < 0 || x + r > map.w || y + r > map.d;

/** Highest surface top at or below `maxZ` under a player footprint (0 = ground). */
export function groundAt(x: number, y: number, maxZ: number, map: ArenaMap = MAP): number {
  let g = 0;
  for (const [top] of spansAt(map, x, y, PLAYER_RADIUS)) if (top <= maxZ + 1e-6 && top > g) g = top;
  return g;
}

/** Highest surface top at (x,y) regardless of height (where an airstrike from above lands). */
export function roofAt(x: number, y: number, map: ArenaMap = MAP): number {
  let g = 0;
  for (const [top] of spansAt(map, x, y, 0.01)) g = Math.max(g, top);
  return g;
}

/** True if a player with feet at z (allowed to step up `step`) would intersect geometry at (x,y). */
export function blockedAt(x: number, y: number, z: number, map: ArenaMap = MAP, step = STEP_HEIGHT, height = PLAYER_HEIGHT): boolean {
  if (outOfBounds(map, x, y)) return true;
  for (const [top, bottom] of spansAt(map, x, y, PLAYER_RADIUS)) if (top > z + step + 1e-6 && bottom < z + height) return true;
  return false;
}

/** True if a player can stand with feet at (x,y,z): not inside geometry. */
export function canStand(x: number, y: number, z = 0, map: ArenaMap = MAP, height = PLAYER_HEIGHT): boolean {
  return !blockedAt(x, y, z, map, 0.02, height);
}

// ---------------------------------------------------------------- movement physics

export interface Body { x: number; y: number; z: number; vz: number; grounded: boolean; crouch?: boolean }

/** True if a crouched body has headroom to stand up where it is. */
export function canUncrouch(b: Body, map: ArenaMap = MAP): boolean {
  return canStand(b.x, b.y, b.z, map, PLAYER_HEIGHT);
}

/** Applies the crouch key: crouching is always allowed; standing up waits until there is headroom. Returns the new state. */
export function applyCrouch(b: Body, want: boolean, map: ArenaMap = MAP): boolean {
  if (want) b.crouch = true;
  else if (b.crouch && canUncrouch(b, map)) b.crouch = false;
  return !!b.crouch;
}

/** Corner slip: walking almost head-on into a box edge that only clips the body by a few cm slides you around it. */
const CORNER_SLIP = 0.15;
function nudge(b: Body, axis: 'x' | 'y', push: number, map: ArenaMap, step: number): void {
  const amt = Math.abs(push);
  const h = heightOf(b);
  const free = (o: number) => (axis === 'y' ? !blockedAt(b.x + push, b.y + o, b.z, map, step, h) : !blockedAt(b.x + o, b.y + push, b.z, map, step, h));
  const plus = free(CORNER_SLIP), minus = free(-CORNER_SLIP);
  if (plus === minus) return; // flat wall (or a gap on both sides): just stop
  const o = (plus ? 1 : -1) * amt;
  if (axis === 'y') { if (!blockedAt(b.x, b.y + o, b.z, map, step, h)) b.y += o; }
  else if (!blockedAt(b.x + o, b.y, b.z, map, step, h)) b.x += o;
}

/** Horizontal move with wall sliding and stair stepping. Mutates and returns the body. */
export function moveHorizontal(b: Body, dx: number, dy: number, map: ArenaMap = MAP): Body {
  const step = b.grounded ? STEP_HEIGHT : 0.05;
  const h = heightOf(b);
  // Sub-step long moves so nobody tunnels through thin geometry (railings, pillars).
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.2));
  for (let i = 0; i < n; i++) {
    const sx = dx / n, sy = dy / n;
    const px = b.x, py = b.y, pz = b.z, pg = b.grounded, pv = b.vz;
    if (!blockedAt(b.x + sx, b.y, b.z, map, step, h)) b.x += sx;
    else if (Math.abs(sx) > Math.abs(sy) * 2) nudge(b, 'y', sx, map, step);
    if (!blockedAt(b.x, b.y + sy, b.z, map, step, h)) b.y += sy;
    else if (Math.abs(sy) > Math.abs(sx) * 2) nudge(b, 'x', sy, map, step);
    if (b.grounded) {
      const g = groundAt(b.x, b.y, b.z + STEP_HEIGHT, map);
      // Walk up a step, or stick to stairs/ramps going down (a small drop).
      if (g > b.z || b.z - g <= STEP_HEIGHT) b.z = g;
      else b.grounded = false; // walked off a ledge: start falling
    } else {
      // Airborne: the 0.05 air step lets feet slide over a top that is just above them (the lip of a crate you
      // almost cleared). Climb onto it right away, or the next vertical step would sink the player inside the box
      // and leave them stuck there (the Dunes crate bug).
      const g = groundAt(b.x, b.y, b.z + step, map);
      if (g > b.z) { b.z = g; if (b.vz <= 0) { b.vz = 0; b.grounded = true; } }
    }
    // Never end a sub-step inside geometry (e.g. stepping up under a low ceiling): undo it and stop here.
    if (!canStand(b.x, b.y, b.z, map, h) && canStand(px, py, pz, map, h)) { Object.assign(b, { x: px, y: py, z: pz, grounded: pg, vz: pv }); break; }
  }
  return b;
}

/** Gravity, landing and head bumps for dt seconds. Mutates and returns the body. */
export function stepVertical(b: Body, dt: number, map: ArenaMap = MAP): Body {
  let left = Math.max(0, Math.min(dt, 1));
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 60);
    left -= h;
    const support = groundAt(b.x, b.y, b.z + 0.02, map);
    if (b.grounded && b.vz <= 0) {
      if (b.z - support > 1e-3) b.grounded = false;
      else { b.z = support; b.vz = 0; continue; }
    }
    const z0 = b.z;
    b.vz -= GRAVITY * h;
    let z1 = z0 + b.vz * h;
    const ph = heightOf(b);
    if (b.vz > 0) {
      // Head bump: any solid whose underside is between the old and new head height.
      for (const s of map.solids) {
        if (!overlapsXY(s, b.x, b.y, PLAYER_RADIUS)) continue;
        if (s.z0 >= z0 + ph - 1e-3 && s.z0 < z1 + ph) { z1 = s.z0 - ph; b.vz = 0; }
      }
    }
    const land = groundAt(b.x, b.y, z0 + 0.02, map);
    if (z1 <= land) { b.z = land; b.vz = 0; b.grounded = true; }
    else { b.z = Math.max(z1, KILL_Z); b.grounded = false; }
  }
  return b;
}

/** Starts a jump if standing on something. */
export function tryJump(b: Body): boolean {
  if (!b.grounded) return false;
  b.vz = JUMP_SPEED;
  b.grounded = false;
  return true;
}

/** Apex height of a standing jump. */
export const JUMP_APEX = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);

// ---------------------------------------------------------------- rays

export interface Vec3 { x: number; y: number; z: number }
export const dirFrom = (a: number, p: number): Vec3 => ({ x: Math.cos(p) * Math.cos(a), y: Math.cos(p) * Math.sin(a), z: Math.sin(p) });

/** Ray/AABB slab test; returns entry distance or Infinity. */
function rayBox(o: Vec3, d: Vec3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let tmin = 0, tmax = Infinity;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]] as const) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return Infinity; continue; }
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Ray vs a ramp: its sloped top surface (and the high end face). */
function rayRamp(o: Vec3, d: Vec3, r: Ramp): number {
  // March in small steps over the ramp's bounding box; ramps are few and the box test rejects most rays.
  const enter = rayBox(o, d, r.x0, r.y0, 0, r.x1, r.y1, r.zHigh);
  if (!Number.isFinite(enter)) return Infinity;
  for (let t = enter; t < enter + 30; t += 0.05) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (!inside(r, x, y)) { if (t > enter + 0.06) return Infinity; continue; }
    if (z <= rampTop(r, x, y)) return t;
  }
  return Infinity;
}

/** Distance along a ray from o in unit direction d to the first piece of world geometry (or maxDist). */
export function rayWorld(o: Vec3, d: Vec3, map: ArenaMap = MAP, maxDist = 64): number {
  let best = maxDist;
  if (d.z < -1e-9) best = Math.min(best, -o.z / d.z); // ground plane
  for (const s of map.solids) {
    const t = rayBox(o, d, s.x0, s.y0, s.z0, s.x1, s.y1, s.z1);
    if (t < best) best = t;
  }
  for (const r of map.ramps) {
    const t = rayRamp(o, d, r);
    if (t < best) best = t;
  }
  return Math.max(0, best);
}

/** True if nothing solid lies between two points. */
export function lineOfSight(a: Vec3, b: Vec3, map: ArenaMap = MAP): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  if (dist < 1e-6) return true;
  const d = { x: (b.x - a.x) / dist, y: (b.y - a.y) / dist, z: (b.z - a.z) / dist };
  return rayWorld(a, d, map, dist) >= dist - 0.05;
}

export interface Target {
  id: string;
  x: number;
  y: number;
  z: number;
  alive: boolean;
  crouch?: boolean;
  sprint?: boolean;
}

export const eyeOf = (s: { x: number; y: number; z: number; crouch?: boolean }): Vec3 => ({ x: s.x, y: s.y, z: s.z + eyeHeightOf(s) });
export const chestOf = (s: { x: number; y: number; z: number; crouch?: boolean }): Vec3 => ({ x: s.x, y: s.y, z: s.z + (s.crouch ? 0.62 : 1.0) });

/** Ray vs one fighter's hitboxes: body box and head sphere. */
export function rayFighter(o: Vec3, d: Vec3, t: Target): { dist: number; head: boolean } | null {
  // head sphere
  const cx = t.x - o.x, cy = t.y - o.y, cz = t.z + headZOf(t) - o.z;
  const along = cx * d.x + cy * d.y + cz * d.z;
  let head = Infinity;
  if (along > 0) {
    const perp2 = cx * cx + cy * cy + cz * cz - along * along;
    if (perp2 <= HEAD_R * HEAD_R) head = along - Math.sqrt(HEAD_R * HEAD_R - perp2);
  }
  const body = rayBox(o, d, t.x - BODY_HALF, t.y - BODY_HALF, t.z, t.x + BODY_HALF, t.y + BODY_HALF, t.z + bodyTopOf(t));
  if (!Number.isFinite(head) && !Number.isFinite(body)) return null;
  return head < body ? { dist: head, head: true } : { dist: body, head: false };
}

/** Hitscan from the shooter's eye along yaw/pitch: nearest living target in front of the first wall. */
export function hitscan(
  shooter: { id: string; x: number; y: number; z: number; a: number; p: number; crouch?: boolean },
  targets: Target[],
  map: ArenaMap = MAP,
  range = MAX_RANGE,
): { id: string; dist: number; head: boolean } | null {
  const o = eyeOf(shooter);
  const d = dirFrom(shooter.a, shooter.p);
  const wall = rayWorld(o, d, map, range);
  let best: { id: string; dist: number; head: boolean } | null = null;
  for (const t of targets) {
    if (t.id === shooter.id || !t.alive) continue;
    const h = rayFighter(o, d, t);
    if (!h || h.dist > wall || h.dist <= 0) continue;
    if (!best || h.dist < best.dist) best = { id: t.id, ...h };
  }
  return best;
}

export interface Fighter {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  vz: number;
  grounded: boolean;
  a: number;
  p: number;
  hp: number;
  kills: number;
  deaths: number;
  alive: boolean;
  respawnAt: number;
  lastShot: number;
  lastMove: number;
  crouch?: boolean;
  sprint?: boolean;
}

/** Applies damage. Returns true if this hit killed the target. */
export function applyDamage(target: Fighter, now: number, amount = DAMAGE): boolean {
  if (!target.alive) return false;
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp > 0) return false;
  target.alive = false;
  target.deaths += 1;
  target.respawnAt = now + RESPAWN_MS;
  return true;
}

type Pos = { x: number; y: number; z?: number; alive: boolean };
/** True if a spawn point has room for a player and is not on top of a living player. */
export function spawnClear(x: number, y: number, others: Pos[], map: ArenaMap = MAP, z = groundAt(x, y, 99, map)): boolean {
  if (!canStand(x, y, z, map)) return false;
  return others.every((o) => !o.alive || Math.hypot(o.x - x, o.y - y, (o.z ?? z) - z) >= PLAYER_RADIUS * 3);
}

/** A coarse grid of open standing spots (fallback spawns if every fixed spawn is blocked). */
export function openSpots(map: ArenaMap = MAP): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let y = 1.5; y < map.d - 1; y += 2) for (let x = 1.5; x < map.w - 1; x += 2) {
    const z = groundAt(x, y, 99, map);
    if (canStand(x, y, z, map)) out.push([x, y, z]);
  }
  return out;
}

/** Picks the clear spawn farthest from living players. Spawn z is the real floor height there. */
export function pickSpawn(others: Pos[], rand: () => number = Math.random, map: ArenaMap = MAP): [number, number, number] {
  const fix = ([x, y, z]: [number, number, number]): [number, number, number] => [x, y, groundAt(x, y, z + STEP_HEIGHT, map)];
  let pool = map.spawns.map(fix).filter(([x, y, z]) => spawnClear(x, y, others, map, z));
  if (!pool.length) pool = openSpots(map).filter(([x, y, z]) => spawnClear(x, y, others, map, z));
  if (!pool.length) pool = openSpots(map);
  let best = pool[Math.floor(rand() * pool.length)] ?? [1.5, 1.5, 0];
  let bestScore = -1;
  for (const s of pool) {
    let nearest = Infinity;
    for (const o of others) if (o.alive) nearest = Math.min(nearest, Math.hypot(o.x - s[0], o.y - s[1]));
    const score = nearest + rand() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return [best[0], best[1], best[2]];
}

/** Respawns a dead fighter if its timer is up. Returns true if respawned. */
export function maybeRespawn(f: Fighter, now: number, others: Fighter[], rand: () => number = Math.random, map: ArenaMap = MAP): boolean {
  if (f.alive || now < f.respawnAt) return false;
  const [x, y, z] = pickSpawn(others.filter((o) => o.id !== f.id), rand, map);
  Object.assign(f, { x, y, z, vz: 0, grounded: true, p: 0, hp: MAX_HP, alive: true });
  return true;
}

/**
 * Server-side validation of a client position report. Horizontal distance is capped by speed × time,
 * then collision is re-run on the server (walls, stairs). Height is never taken from the client: it comes
 * from the server's own gravity/jump simulation, so nobody can fly or teleport.
 */
export function validateMove(f: Body, nx: unknown, ny: unknown, dtMs: number, map: ArenaMap = MAP): Body {
  if (typeof nx !== 'number' || typeof ny !== 'number' || !Number.isFinite(nx) || !Number.isFinite(ny)) return f;
  const allowed = speedOf(f) * (Math.min(Math.max(dtMs, 0), 500) / 1000) * 1.5 + 0.1;
  let dx = nx - f.x;
  let dy = ny - f.y;
  const d = Math.hypot(dx, dy);
  if (d > allowed) {
    dx = (dx / d) * allowed;
    dy = (dy / d) * allowed;
  }
  return moveHorizontal(f, dx, dy, map);
}

export function normAngle(a: unknown): number | null {
  if (typeof a !== 'number' || !Number.isFinite(a)) return null;
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
export function clampPitch(p: unknown): number | null {
  if (typeof p !== 'number' || !Number.isFinite(p)) return null;
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p));
}

export function guestName(rand: () => number = Math.random): string {
  return `Guest${100 + Math.floor(rand() * 900)}`;
}

// ---------------------------------------------------------------- weapons

export type WeaponId = 'pistol' | 'smg' | 'shotgun' | 'sniper' | 'rocket';
export interface WeaponSpec {
  id: WeaponId;
  name: string;
  /** Damage per pellet (rockets: direct-hit / splash centre damage). */
  damage: number;
  cooldownMs: number;
  pellets: number;
  /** Half-angle of random spread, radians. */
  spread: number;
  range: number;
  mag: number;
  reloadMs: number;
  /** Rockets only: splash radius in tiles. */
  splash?: number;
  /** Sniper only: spread while scoped. */
  scopedSpread?: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: { id: 'pistol', name: 'M9 Sidearm', damage: 34, cooldownMs: 300, pellets: 1, spread: 0.01, range: 30, mag: 12, reloadMs: 1100 },
  smg: { id: 'smg', name: 'SMG-9', damage: 14, cooldownMs: 90, pellets: 1, spread: 0.05, range: 24, mag: 30, reloadMs: 1700 },
  shotgun: { id: 'shotgun', name: 'M1014 Combat Shotgun', damage: 17, cooldownMs: 800, pellets: 9, spread: 0.12, range: 10, mag: 6, reloadMs: 2200 },
  sniper: { id: 'sniper', name: '.50 Cal Sniper', damage: 95, cooldownMs: 1300, pellets: 1, spread: 0.09, scopedSpread: 0, range: 70, mag: 5, reloadMs: 2500 },
  rocket: { id: 'rocket', name: 'RPG Launcher', damage: 100, cooldownMs: 1100, pellets: 1, spread: 0, range: 40, mag: 2, reloadMs: 2600, splash: 2.4 },
};
export const WEAPON_ORDER: WeaponId[] = ['pistol', 'smg', 'shotgun', 'sniper', 'rocket'];
export const SWITCH_MS = 250;
export const SCOPE_SETTLE_MS = 250;
/** Self-damage multiplier for your own rocket splash. */
export const SELF_SPLASH = 0.5;

export function isWeapon(w: unknown): w is WeaponId {
  return typeof w === 'string' && (WEAPON_ORDER as string[]).includes(w);
}

/** Damage at distance d from an explosion centre: full at 0, linear falloff to 0 at radius. */
export function splashFalloff(max: number, radius: number, d: number): number {
  if (d >= radius) return 0;
  return Math.round(max * (1 - d / radius));
}

/** Everyone (living) within radius (3D, to their chest) of point c with line of sight to it, with splash damage. */
export function splashTargets(
  c: Vec3, radius: number, max: number, targets: Target[], map: ArenaMap = MAP,
): Array<{ id: string; damage: number; dist: number }> {
  const out: Array<{ id: string; damage: number; dist: number }> = [];
  for (const t of targets) {
    if (!t.alive) continue;
    // Nearest point of the body column to the blast.
    const pz = Math.min(t.z + heightOf(t), Math.max(t.z, c.z));
    const d = Math.hypot(t.x - c.x, t.y - c.y, pz - c.z);
    if (d >= radius) continue;
    const from = { x: c.x, y: c.y, z: c.z + 0.15 };
    if (!lineOfSight(from, { x: t.x, y: t.y, z: pz + 0.05 }, map) && !lineOfSight(from, chestOf(t), map)) continue; // wall/floor in the way
    const damage = splashFalloff(max, radius, d);
    if (damage > 0) out.push({ id: t.id, damage, dist: d });
  }
  return out;
}

export interface ShotResult {
  /** Damage per target id (pellets summed). */
  hits: Map<string, number>;
  /** Target ids that took at least one headshot. */
  heads: Set<string>;
  /** Rocket impact point, if any. */
  impact?: Vec3;
  /** Rays for tracers: yaw, pitch, length. */
  rays: Array<{ a: number; p: number; dist: number; hit?: string }>;
}

/** Resolves one trigger pull of a weapon. Pure; the server decides whether the pull was allowed. */
export function fireWeapon(
  shooter: { id: string; x: number; y: number; z: number; a: number; p: number; crouch?: boolean },
  weapon: WeaponSpec,
  targets: Target[],
  opts: { scoped?: boolean; rand?: () => number; map?: ArenaMap } = {},
): ShotResult {
  const rand = opts.rand ?? Math.random;
  const map = opts.map ?? MAP;
  const spread = (weapon.id === 'sniper' && opts.scoped ? weapon.scopedSpread ?? 0 : weapon.spread) * (shooter.crouch ? CROUCH_SPREAD_MULT : 1);
  const hits = new Map<string, number>();
  const heads = new Set<string>();
  const rays: ShotResult['rays'] = [];
  const eye = eyeOf(shooter);
  if (weapon.splash) {
    const { a, p } = shooter;
    const d = dirFrom(a, p);
    const wall = rayWorld(eye, d, map, weapon.range);
    const direct = hitscan(shooter, targets, map, weapon.range);
    const dist = Math.max(0, (direct ? direct.dist : wall) - 0.08);
    const impact = { x: eye.x + d.x * dist, y: eye.y + d.y * dist, z: eye.z + d.z * dist };
    rays.push({ a, p, dist });
    if (direct) hits.set(direct.id, weapon.damage);
    for (const s of splashTargets(impact, weapon.splash, weapon.damage, targets, map)) {
      if (s.id === direct?.id) continue;
      const dmg = s.id === shooter.id ? Math.round(s.damage * SELF_SPLASH) : s.damage;
      if (dmg > 0) hits.set(s.id, dmg);
    }
    return { hits, heads, impact, rays };
  }
  for (let i = 0; i < weapon.pellets; i++) {
    const a = shooter.a + (rand() * 2 - 1) * spread;
    const p = shooter.p + (rand() * 2 - 1) * spread * 0.6;
    const hit = hitscan({ ...shooter, a, p }, targets, map, weapon.range);
    rays.push({ a, p, dist: hit ? hit.dist : rayWorld(eye, dirFrom(a, p), map, weapon.range), ...(hit ? { hit: hit.id } : {}) });
    if (hit) {
      hits.set(hit.id, (hits.get(hit.id) ?? 0) + weapon.damage * (hit.head ? HEADSHOT_MULT : 1));
      if (hit.head) heads.add(hit.id);
    }
  }
  return { hits, heads, rays };
}

// ---------------------------------------------------------------- killstreaks

export type StreakKind = 'uav' | 'airstrike' | 'drone' | 'nuke';
export const STREAKS: Array<{ kills: number; kind: StreakKind; name: string; blurb: string }> = [
  { kills: 3, kind: 'uav', name: 'UAV', blurb: 'Enemy positions on radar for 20s' },
  { kills: 5, kind: 'airstrike', name: 'PRECISION AIRSTRIKE', blurb: 'Air support inbound on your aim point' },
  { kills: 7, kind: 'drone', name: 'ATTACK DRONE', blurb: 'Armed drone on station for 20s' },
  { kills: 11, kind: 'nuke', name: 'TACTICAL NUKE', blurb: 'Ends the round for everyone' },
];
export const UAV_MS = 20_000;
export const AIRSTRIKE_DELAY_MS = 2500;
export const AIRSTRIKE_RADIUS = 3;
export const AIRSTRIKE_DAMAGE = 130;
export const AIRSTRIKE_RANGE = 12;
/** Zone stops following its target this long before impact (time to run). */
export const AIRSTRIKE_LOCK_MS = 1000;
export const AIRSTRIKE_SPACING = 2.2;
/** How long a call waits for a live enemy before dropping on the aim point. */
export const AIRSTRIKE_WAIT_MS = 8000;
export const DRONE_MS = 20_000;
export const DRONE_COOLDOWN_MS = 500;
export const DRONE_DAMAGE = 12;
export const DRONE_RANGE = 10;
export const NUKE_DELAY_MS = 6000;
export const NUKE_RESPAWN_MS = 5000;

export function streakReward(streak: number): StreakKind | null {
  return STREAKS.find((s) => s.kills === streak)?.kind ?? null;
}

// ---------------------------------------------------------------- rockets (real projectiles)

/** RPG rockets fly at this speed (tiles/s) with a slight gravity drop, and burst after ROCKET_LIFE_MS. */
export const ROCKET_SPEED = 24;
export const ROCKET_GRAVITY = 1.2;
export const ROCKET_LIFE_MS = 2500;
/** The rocket leaves the tube this far ahead of the eye, slightly low and right. */
export const ROCKET_MUZZLE = 0.55;

export interface Rocket { id: number; ownerId: string; x: number; y: number; z: number; vx: number; vy: number; vz: number; born: number; at: number }

/** A rocket leaving the shooter's tube along their aim. */
export function launchRocket(id: number, shooter: { id: string; x: number; y: number; z: number; a: number; p: number; crouch?: boolean }, now: number): Rocket {
  const e = eyeOf(shooter);
  const d = dirFrom(shooter.a, shooter.p);
  return { id, ownerId: shooter.id, x: e.x + d.x * ROCKET_MUZZLE, y: e.y + d.y * ROCKET_MUZZLE, z: e.z - 0.12 + d.z * ROCKET_MUZZLE, vx: d.x * ROCKET_SPEED, vy: d.y * ROCKET_SPEED, vz: d.z * ROCKET_SPEED, born: now, at: now };
}

/**
 * Moves a rocket forward to `now`, checking each short segment against the world and every living fighter
 * except its owner. Returns the impact point (and who was struck directly), or null if it is still flying.
 * Mutates the rocket. Out of time = it bursts where it is.
 */
export function stepRocket(r: Rocket, now: number, targets: Target[], map: ArenaMap = MAP): { x: number; y: number; z: number; direct: string | null } | null {
  let left = Math.max(0, now - r.at) / 1000;
  r.at = Math.max(r.at, now);
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 60);
    left -= h;
    r.vz -= ROCKET_GRAVITY * h;
    const sp = Math.hypot(r.vx, r.vy, r.vz);
    const seg = sp * h;
    const d = { x: r.vx / sp, y: r.vy / sp, z: r.vz / sp };
    const o = { x: r.x, y: r.y, z: r.z };
    let best = rayWorld(o, d, map, seg + 1e-6);
    let direct: string | null = null;
    for (const t of targets) {
      if (!t.alive || t.id === r.ownerId) continue;
      const hit = rayFighter(o, d, t);
      if (hit && hit.dist >= 0 && hit.dist <= best) { best = hit.dist; direct = t.id; }
    }
    // Leaving the map's bounds counts as hitting the perimeter.
    const nx = o.x + d.x * seg, ny = o.y + d.y * seg;
    const outside = nx < 0 || ny < 0 || nx > map.w || ny > map.d;
    if (best < seg || direct || outside) {
      const back = Math.max(0, best - 0.08);
      const dist = outside && !direct && best >= seg ? Math.max(0, seg - 0.08) : back;
      return { x: o.x + d.x * dist, y: o.y + d.y * dist, z: Math.max(0.02, o.z + d.z * dist), direct };
    }
    r.x = nx; r.y = ny; r.z = o.z + d.z * seg;
    if (now - r.born >= ROCKET_LIFE_MS && left <= 1e-6) return { x: r.x, y: r.y, z: r.z, direct: null };
  }
  if (now - r.born >= ROCKET_LIFE_MS) return { x: r.x, y: r.y, z: r.z, direct: null };
  return null;
}

/** Rocket damage on impact: full to a direct hit, falloff splash to everyone near, half to its owner. */
export function rocketDamage(
  impact: Vec3, direct: string | null, ownerId: string, targets: Target[], map: ArenaMap = MAP, spec: WeaponSpec = WEAPONS.rocket,
): Map<string, number> {
  const hits = new Map<string, number>();
  if (direct) hits.set(direct, spec.damage);
  for (const s of splashTargets(impact, spec.splash ?? 2.4, spec.damage, targets, map)) {
    if (s.id === direct) continue;
    const dmg = s.id === ownerId ? Math.round(s.damage * SELF_SPLASH) : s.damage;
    if (dmg > 0) hits.set(s.id, dmg);
  }
  return hits;
}

/** Outward face normal of world geometry at a hit point (for bullet holes and sparks). Ground/ramps = up. */
export function surfaceNormal(pt: Vec3, map: ArenaMap = MAP): Vec3 {
  let best = { d: pt.z < 0.03 ? Math.abs(pt.z) : Infinity, n: { x: 0, y: 0, z: 1 } };
  const eps = 0.12;
  for (const s of map.solids) {
    if (pt.x < s.x0 - eps || pt.x > s.x1 + eps || pt.y < s.y0 - eps || pt.y > s.y1 + eps || pt.z < s.z0 - eps || pt.z > s.z1 + eps) continue;
    const faces: Array<[number, Vec3]> = [
      [Math.abs(pt.x - s.x0), { x: -1, y: 0, z: 0 }], [Math.abs(pt.x - s.x1), { x: 1, y: 0, z: 0 }],
      [Math.abs(pt.y - s.y0), { x: 0, y: -1, z: 0 }], [Math.abs(pt.y - s.y1), { x: 0, y: 1, z: 0 }],
      [Math.abs(pt.z - s.z0), { x: 0, y: 0, z: -1 }], [Math.abs(pt.z - s.z1), { x: 0, y: 0, z: 1 }],
    ];
    for (const [d, n] of faces) if (d < best.d) best = { d, n };
  }
  return best.n;
}
