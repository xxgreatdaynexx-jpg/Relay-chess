import { beforeEach, describe, expect, it } from 'vitest';
import { resetMines, type MinesWorld } from '../server/mines';
import { resetBank } from '../server/casino-store';
import { CAVES, CELL, REACH, inExit, type CaveId } from '../shared/mines';
import { canStand, eyeHeightOf, moveHorizontal, PLAYER_RADIUS, type Body } from '../shared/fps';

// Flood fill over a 0.25 m lattice, stepping with the real collision (moveHorizontal, PLAYER_RADIUS) so a
// passage the player's body cannot fit through, or a spawn wedged in rock, fails here.
const STEP = 0.25;
function reach(cave: CaveId, sx: number, sy: number) {
  const map = CAVES[cave].map, seen = new Set<string>(), pts: [number, number][] = [], q: [number, number][] = [[sx, sy]];
  const key = (x: number, y: number) => `${Math.round(x / STEP)},${Math.round(y / STEP)}`;
  seen.add(key(sx, sy));
  while (q.length) {
    const [x, y] = q.pop()!; pts.push([x, y]);
    for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const b: Body = { x, y, z: 0, vz: 0, grounded: true };
      moveHorizontal(b, dx, dy, map);
      if (Math.abs(b.x - (x + dx)) > 1e-6 || Math.abs(b.y - (y + dy)) > 1e-6) continue; // blocked (no slide credit)
      const k = key(b.x, b.y); if (seen.has(k)) continue; seen.add(k); q.push([b.x, b.y]);
    }
  }
  return pts;
}

let w: MinesWorld;
beforeEach(() => { resetBank(); w = resetMines(); });

describe('cave reachability with the real player radius', () => {
  for (const cave of Object.keys(CAVES) as CaveId[]) {
    it(`${cave}: every spawn stands free, reaches the EXIT and every ore node`, () => {
      const { map, nodes } = CAVES[cave];
      expect(PLAYER_RADIUS).toBeGreaterThan(0);
      for (const [sx, sy] of map.spawns) {
        expect(canStand(sx, sy, 0, map), `${cave} spawn ${sx},${sy}`).toBe(true);
        const pts = reach(cave, sx, sy);
        expect(pts.length, `${cave} spawn ${sx},${sy} is boxed in`).toBeGreaterThan(50);
        expect(pts.some(([x, y]) => inExit(x, y)), `${cave} EXIT`).toBe(true);
        const eye = eyeHeightOf({ crouch: false } as never);
        const missing = nodes.filter((n) => !pts.some(([x, y]) => Math.hypot(n.x - x, n.y - y, n.z - eye) <= REACH - 0.05)).map((n) => n.id);
        expect(missing, `${cave} unreachable nodes`).toEqual([]);
      }
    });
  }
});

describe('switching caves on one socket', () => {
  it('moves the miner to the new cave spawn instead of keeping the old cave', () => {
    const m = w.join('s1', null, Date.now(), 'mine');
    m.x = 40; m.y = 9;
    w.moveToCave(m, 'magma');
    expect(m.cave).toBe('magma');
    expect(canStand(m.x, m.y, m.z, CAVES.magma.map)).toBe(true);
    expect(CAVES.magma.map.spawns.some(([x, y]) => x === m.x && y === m.y)).toBe(true);
  });
});

// r18: the flood fill above only proved every node/EXIT is reachable by SOME route, so a lava pool that fully
// severed a corridor (Magma had four, Frostbite one ice pillar) still passed while players hit a dead end. These two checks close that gap.
const isHaz = (c: string) => c === '~';
const isFloor = (c: string) => c !== '#' && c !== '~';
describe('hazards never sever a passage', () => {
  for (const cave of Object.keys(CAVES) as CaveId[]) {
    it(`${cave}: every walkable cell is reached from every spawn with the real collision`, () => {
      const { rows, map } = CAVES[cave];
      for (const [sx, sy] of map.spawns) {
        const cells = new Set(reach(cave, sx, sy).map(([x, y]) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`));
        const missing: string[] = [];
        rows.forEach((r, y) => [...r].forEach((c, x) => { if (isFloor(c) && !cells.has(`${x},${y}`)) missing.push(`${x},${y}`); }));
        expect(missing, `${cave} cells cut off from spawn ${sx},${sy}`).toEqual([]);
      }
    });
    it(`${cave}: walking around each hazard pool is a short detour (no pool blocks a corridor)`, () => {
      const { rows } = CAVES[cave]; const H = rows.length, W = rows[0].length;
      const at = (x: number, y: number) => (y < 0 || y >= H || x < 0 || x >= W ? '#' : rows[y][x]);
      const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const bfs = (sx: number, sy: number, pass: (c: string) => boolean) => {
        const d = new Map<string, number>([[`${sx},${sy}`, 0]]); const q = [[sx, sy]];
        for (let i = 0; i < q.length; i++) { const [x, y] = q[i]; for (const [dx, dy] of N4) { const k = `${x + dx},${y + dy}`; if (!d.has(k) && pass(at(x + dx, y + dy))) { d.set(k, d.get(`${x},${y}`)! + 1); q.push([x + dx, y + dy]); } } }
        return d;
      };
      const seen = new Set<string>(); const bad: string[] = [];
      rows.forEach((r, y) => [...r].forEach((c, x) => {
        if (!isHaz(c) || seen.has(`${x},${y}`)) return;
        const pool = [...bfs(x, y, isHaz).keys()]; pool.forEach((k) => seen.add(k));
        const rim = new Set<string>();
        for (const k of pool) { const [px, py] = k.split(',').map(Number); for (const [dx, dy] of N4) if (isFloor(at(px + dx, py + dy))) rim.add(`${px + dx},${py + dy}`); }
        const rimA = [...rim];
        for (const a of rimA) {
          const [ax, ay] = a.split(',').map(Number);
          const around = bfs(ax, ay, isFloor), through = bfs(ax, ay, (ch) => isFloor(ch) || isHaz(ch));
          for (const b of rimA) if (b !== a && (around.get(b) ?? Infinity) > through.get(b)! + 4) bad.push(`pool@${pool[0]} ${a}->${b}: ${around.get(b) ?? 'none'} vs ${through.get(b)}`);
        }
      }));
      expect(bad, `${cave} hazard pools that cut a corridor`).toEqual([]);
    });
  }
});
