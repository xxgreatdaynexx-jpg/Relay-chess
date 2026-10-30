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
): { id: string; dist: number } | null {
  const wall = castRay(shooter.x, shooter.y, shooter.a, map, MAX_RANGE).dist;
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
