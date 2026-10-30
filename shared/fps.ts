/** Pure logic for the shared arcade arena (retro raycaster). Used by client and server. */

export const MAP: string[] = [
  '################',
  '#......#.......#',
  '#..##..#..##...#',
  '#..#.......#...#',
  '#......##......#',
  '#.##.......###.#',
  '#....#..#......#',
  '#.#..#..#..##..#',
  '#.#..........#.#',
  '#....###.......#',
  '#..........#...#',
  '#..##..#...#.#.#',
  '#......#.......#',
  '#.###.....##...#',
  '#..............#',
  '################',
];

export const MAX_HP = 100;
export const DAMAGE = 34;
export const RESPAWN_MS = 2000;
export const SHOT_COOLDOWN_MS = 300;
export const MOVE_SPEED = 3.2; // tiles per second
export const PLAYER_RADIUS = 0.25;
export const HIT_RADIUS = 0.32;
export const MAX_RANGE = 20;
export const TICK_HZ = 15;

export const SPAWNS: Array<[number, number]> = [
  [1.5, 1.5], [14.5, 1.5], [1.5, 14.5], [14.5, 14.5], [8.5, 8.5], [4.5, 10.5], [12.5, 4.5], [9.5, 12.5],
];

export function isWall(x: number, y: number, map: string[] = MAP): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cy < 0 || cy >= map.length || cx < 0 || cx >= map[0].length) return true;
  return map[cy][cx] === '#';
}

/** True if a circle of PLAYER_RADIUS at (x,y) overlaps no wall. */
export function canStand(x: number, y: number, map: string[] = MAP): boolean {
  const r = PLAYER_RADIUS;
  return !isWall(x - r, y - r, map) && !isWall(x + r, y - r, map) && !isWall(x - r, y + r, map) && !isWall(x + r, y + r, map);
}

export interface RayHit {
  dist: number;
  side: 0 | 1;
  cellX: number;
  cellY: number;
}

/** DDA raycast from (x,y) along angle. Returns perpendicular-free euclidean distance to first wall. */
export function castRay(x: number, y: number, angle: number, map: string[] = MAP, maxDist = 64): RayHit {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let mapX = Math.floor(x);
  let mapY = Math.floor(y);
  const deltaX = dx === 0 ? 1e30 : Math.abs(1 / dx);
  const deltaY = dy === 0 ? 1e30 : Math.abs(1 / dy);
  const stepX = dx < 0 ? -1 : 1;
  const stepY = dy < 0 ? -1 : 1;
  let sideX = dx < 0 ? (x - mapX) * deltaX : (mapX + 1 - x) * deltaX;
  let sideY = dy < 0 ? (y - mapY) * deltaY : (mapY + 1 - y) * deltaY;
  let side: 0 | 1 = 0;
  for (let i = 0; i < 256; i++) {
    if (sideX < sideY) {
      sideX += deltaX;
      mapX += stepX;
      side = 0;
    } else {
      sideY += deltaY;
      mapY += stepY;
      side = 1;
    }
    const dist = side === 0 ? sideX - deltaX : sideY - deltaY;
    if (dist > maxDist) return { dist: maxDist, side, cellX: mapX, cellY: mapY };
    if (isWall(mapX + 0.5, mapY + 0.5, map)) return { dist, side, cellX: mapX, cellY: mapY };
  }
  return { dist: maxDist, side, cellX: mapX, cellY: mapY };
}

export interface Target {
  id: string;
  x: number;
  y: number;
  alive: boolean;
}

/** Hitscan: nearest living target (not the shooter) within HIT_RADIUS of the ray and in front of the wall. */
export function hitscan(
  shooter: { id: string; x: number; y: number; a: number },
  targets: Target[],
  map: string[] = MAP,
  range = MAX_RANGE,
): { id: string; dist: number } | null {
  const wall = castRay(shooter.x, shooter.y, shooter.a, map, range).dist;
  const dx = Math.cos(shooter.a);
  const dy = Math.sin(shooter.a);
  let best: { id: string; dist: number } | null = null;
  for (const t of targets) {
    if (t.id === shooter.id || !t.alive) continue;
    const rx = t.x - shooter.x;
    const ry = t.y - shooter.y;
    const along = rx * dx + ry * dy;
    if (along <= 0 || along > wall) continue;
    const perp = Math.abs(rx * dy - ry * dx);
    if (perp > HIT_RADIUS) continue;
    if (!best || along < best.dist) best = { id: t.id, dist: along };
  }
  return best;
}

export interface Fighter {
  id: string;
  name: string;
  x: number;
  y: number;
  a: number;
  hp: number;
  kills: number;
  deaths: number;
  alive: boolean;
  respawnAt: number;
  lastShot: number;
  lastMove: number;
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

export function pickSpawn(others: Array<{ x: number; y: number; alive: boolean }>, rand: () => number = Math.random): [number, number] {
  let best = SPAWNS[Math.floor(rand() * SPAWNS.length)];
  let bestScore = -1;
  for (const s of SPAWNS) {
    let nearest = Infinity;
    for (const o of others) if (o.alive) nearest = Math.min(nearest, Math.hypot(o.x - s[0], o.y - s[1]));
    const score = nearest + rand() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** Respawns a dead fighter if its timer is up. Returns true if respawned. */
export function maybeRespawn(f: Fighter, now: number, others: Fighter[], rand: () => number = Math.random): boolean {
  if (f.alive || now < f.respawnAt) return false;
  const [x, y] = pickSpawn(others.filter((o) => o.id !== f.id), rand);
  f.x = x;
  f.y = y;
  f.hp = MAX_HP;
  f.alive = true;
  return true;
}

/** Server-side validation of a client position report. Returns the accepted position. */
export function validateMove(
  f: { x: number; y: number },
  nx: unknown,
  ny: unknown,
  dtMs: number,
  map: string[] = MAP,
): { x: number; y: number } {
  if (typeof nx !== 'number' || typeof ny !== 'number' || !Number.isFinite(nx) || !Number.isFinite(ny)) return { x: f.x, y: f.y };
  const allowed = MOVE_SPEED * (Math.min(Math.max(dtMs, 0), 500) / 1000) * 1.5 + 0.1;
  let dx = nx - f.x;
  let dy = ny - f.y;
  const d = Math.hypot(dx, dy);
  if (d > allowed) {
    dx = (dx / d) * allowed;
    dy = (dy / d) * allowed;
  }
  // Move axis-by-axis so players slide along walls instead of tunnelling.
  let x = f.x;
  let y = f.y;
  if (canStand(x + dx, y, map)) x += dx;
  if (canStand(x, y + dy, map)) y += dy;
  return { x, y };
}

export function normAngle(a: unknown): number | null {
  if (typeof a !== 'number' || !Number.isFinite(a)) return null;
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
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
  pistol: { id: 'pistol', name: 'M9 Sidearm', damage: 34, cooldownMs: 300, pellets: 1, spread: 0.01, range: 20, mag: 12, reloadMs: 1100 },
  smg: { id: 'smg', name: 'SMG-9', damage: 14, cooldownMs: 90, pellets: 1, spread: 0.05, range: 14, mag: 30, reloadMs: 1700 },
  shotgun: { id: 'shotgun', name: 'M1014 Combat Shotgun', damage: 13, cooldownMs: 800, pellets: 8, spread: 0.16, range: 8, mag: 6, reloadMs: 2200 },
  sniper: { id: 'sniper', name: '.50 Cal Sniper', damage: 95, cooldownMs: 1300, pellets: 1, spread: 0.09, scopedSpread: 0, range: 40, mag: 5, reloadMs: 2500 },
  rocket: { id: 'rocket', name: 'RPG Launcher', damage: 100, cooldownMs: 1100, pellets: 1, spread: 0, range: 30, mag: 2, reloadMs: 2600, splash: 2.4 },
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

/** Everyone (living) within radius of (x,y) with line of sight to it, with their splash damage. */
export function splashTargets(
  x: number, y: number, radius: number, max: number, targets: Target[], map: string[] = MAP,
): Array<{ id: string; damage: number; dist: number }> {
  const out: Array<{ id: string; damage: number; dist: number }> = [];
  for (const t of targets) {
    if (!t.alive) continue;
    const d = Math.hypot(t.x - x, t.y - y);
    if (d >= radius) continue;
    if (d > 0.05 && castRay(x, y, Math.atan2(t.y - y, t.x - x), map, d + 0.01).dist < d - 0.05) continue; // wall in the way
    const damage = splashFalloff(max, radius, d);
    if (damage > 0) out.push({ id: t.id, damage, dist: d });
  }
  return out;
}

export interface ShotResult {
  /** Damage per target id (pellets summed). */
  hits: Map<string, number>;
  /** Rocket impact point, if any. */
  impact?: { x: number; y: number };
  /** Ray end points for tracers. */
  rays: Array<{ a: number; dist: number }>;
}

/** Resolves one trigger pull of a weapon. Pure; the server decides whether the pull was allowed. */
export function fireWeapon(
  shooter: { id: string; x: number; y: number; a: number },
  weapon: WeaponSpec,
  targets: Target[],
  opts: { scoped?: boolean; rand?: () => number; map?: string[] } = {},
): ShotResult {
  const rand = opts.rand ?? Math.random;
  const map = opts.map ?? MAP;
  const spread = weapon.id === 'sniper' && opts.scoped ? weapon.scopedSpread ?? 0 : weapon.spread;
  const hits = new Map<string, number>();
  const rays: ShotResult['rays'] = [];
  if (weapon.splash) {
    const a = shooter.a;
    const wall = castRay(shooter.x, shooter.y, a, map, weapon.range).dist;
    const direct = hitscan({ ...shooter, a }, targets, map, weapon.range);
    const dist = Math.max(0, (direct ? direct.dist : wall) - 0.08);
    const impact = { x: shooter.x + Math.cos(a) * dist, y: shooter.y + Math.sin(a) * dist };
    rays.push({ a, dist });
    if (direct) hits.set(direct.id, weapon.damage);
    for (const s of splashTargets(impact.x, impact.y, weapon.splash, weapon.damage, targets, map)) {
      if (s.id === direct?.id) continue;
      const dmg = s.id === shooter.id ? Math.round(s.damage * SELF_SPLASH) : s.damage;
      if (dmg > 0) hits.set(s.id, dmg);
    }
    return { hits, impact, rays };
  }
  for (let i = 0; i < weapon.pellets; i++) {
    const a = shooter.a + (rand() * 2 - 1) * spread;
    const hit = hitscan({ ...shooter, a }, targets, map, weapon.range);
    rays.push({ a, dist: hit ? hit.dist : castRay(shooter.x, shooter.y, a, map, weapon.range).dist });
    if (hit) hits.set(hit.id, (hits.get(hit.id) ?? 0) + weapon.damage);
  }
  return { hits, rays };
}

// ---------------------------------------------------------------- jumping

export const JUMP_MS = 560;
/** Minimum time between jump starts (airtime + a short landing). */
export const JUMP_COOLDOWN_MS = 700;
export const JUMP_HEIGHT = 0.32;

/** Height above the floor (tiles) t ms after a jump started. */
export function jumpHeight(sinceMs: number): number {
  if (sinceMs < 0 || sinceMs >= JUMP_MS) return 0;
  const t = sinceMs / JUMP_MS;
  return 4 * JUMP_HEIGHT * t * (1 - t);
}

export function canJump(lastJumpAt: number, now: number): boolean {
  return now - lastJumpAt >= JUMP_COOLDOWN_MS;
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
export const DRONE_MS = 20_000;
export const DRONE_COOLDOWN_MS = 500;
export const DRONE_DAMAGE = 12;
export const DRONE_RANGE = 10;
export const NUKE_DELAY_MS = 6000;
export const NUKE_RESPAWN_MS = 5000;

export function streakReward(streak: number): StreakKind | null {
  return STREAKS.find((s) => s.kills === streak)?.kind ?? null;
}
