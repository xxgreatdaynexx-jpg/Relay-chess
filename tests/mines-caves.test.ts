import { beforeEach, describe, expect, it } from 'vitest';
import { MinesWorld, resetMines } from '../server/mines';
import { resetBank } from '../server/casino-store';
import { CAVES, CAVE_DEFS, CELL, ORES, REACH, SWING_MIN_MS, caveValueRate, inExit, type CaveId } from '../shared/mines';
import { canStand, eyeHeightOf } from '../shared/fps';
import { MINE_SITES, MINE_APRON, PLATE, PARK_AREA, landmarks, obbOverlap } from '../shared/worldLayout';
import { MAP_BOUNDS, FARM_X0, FARM_X1, FARM_Z0, FARM_Z1 } from '../shared/farm';
import { propertyById } from '../shared/realEstate';

let w: MinesWorld;
beforeEach(() => { resetBank(); w = resetMines(); });
const ids = Object.keys(CAVES) as CaveId[];

describe('three caves (pt1201u)', () => {
  it('each cave is fully connected, spawns in the EXIT lift, and has its own layout', () => {
    for (const id of ids) {
      const map = CAVES[id].map; const W = map.w / CELL, D = map.d / CELL;
      const open = (x: number, y: number) => canStand(x * CELL + 1, y * CELL + 1, 0, map);
      const seen = new Set<string>(); const q = [[Math.floor(map.spawns[0][0] / CELL), Math.floor(map.spawns[0][1] / CELL)]];
      while (q.length) { const [x, y] = q.pop()!; const k = `${x},${y}`; if (seen.has(k) || !open(x, y)) continue; seen.add(k); q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
      let total = 0; for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) if (open(x, y)) total++;
      expect(seen.size, id).toBe(total);
      for (const s of map.spawns) expect(inExit(s[0], s[1]), id).toBe(true);
      expect(CAVES[id].nodes.length, id).toBeGreaterThan(40);
    }
    expect(new Set(CAVE_DEFS.map((c) => c.rows.join('\n'))).size).toBe(CAVE_DEFS.length);
    expect(new Set(CAVE_DEFS.map((c) => c.theme.sky)).size).toBe(CAVE_DEFS.length);
  });
  it('average value per placed node stays within 5% of before the pt1354u spawn bias (pt1357u: ~85% signature) (Coral untouched)', () => {
    // pt1354u: the theoretical caveValueRate() no longer tracks the hashed node layout once biases are this strong,
    // so balance is held on the real nodes players mine (house value per node).
    const BEFORE: Record<string, number> = { mine: 5.606, frost: 6.665, magma: 2.674, coral: 9.894, fortmc: 3.704 }; // coral: #10d premium Grotto (Fire Opal + Abyssal Pearl, more gold/crystal), ~1.36x The Mine // fortmc: Nov 4 walk-in Fort McChud Mine (industrial ores; their plant-feed value comes on top)
    for (const id of ids) { const n = CAVES[id].nodes; const v = n.reduce((a, x) => a + ORES[x.ore].price, 0) / n.length;
      expect(Math.abs(v / BEFORE[id]! - 1), id).toBeLessThan(id === 'coral' ? 0.001 : 0.05); expect(caveValueRate(CAVES[id]), id).toBeGreaterThan(0); }
  });
  it('miners join a chosen cave and mine that cave’s rock only', () => {
    w.join('f', 'QA-Frost', 0, 'frost'); w.join('m', 'QA-Main', 0); w.join('x', 'QA-Bad', 0, 'nope');
    expect(w.miners.get('f')!.cave).toBe('frost'); expect(w.miners.get('m')!.cave).toBe('mine'); expect(w.miners.get('x')!.cave).toBe('mine');
    const nodes = CAVES.frost.nodes; const m = w.miners.get('f')!;
    let idx = -1;
    for (let i = 0; i < nodes.length && idx < 0; i++) { const n = nodes[i];
      for (let r = 0.9; r < 2.5 && idx < 0; r += 0.1) for (let k = 0; k < 16; k++) { const x = n.x + Math.cos(k / 16 * Math.PI * 2) * r, y = n.y + Math.sin(k / 16 * Math.PI * 2) * r;
        if (canStand(x, y, 0, CAVES.frost.map) && Math.hypot(n.x - x, n.y - y, n.z - eyeHeightOf(m)) - 0.55 < REACH - 0.2) { m.x = x; m.y = y; m.a = Math.atan2(n.y - y, n.x - x); idx = i; break; } } }
    expect(idx).toBeGreaterThanOrEqual(0);
    let t = 1000, r; do { r = w.hit('f', idx, t); t += SWING_MIN_MS; } while (!r.broke && !r.full);
    expect(r.ore).toBe(nodes[idx].ore);
    expect(w.nodesView(t, 'frost')[idx]).toBe(-1);
    expect(w.nodesView(t, 'mine')[idx]).toBe(ORES[CAVES.mine.nodes[idx].ore].hits);
    expect(w.playersView('frost').map((p) => p.id)).toEqual(['f']);
  });
  it('mines sit on the outskirts: off the plate, apart, clear of farm and Trailer Park, inside the pan bounds', () => {
    const lms = landmarks(); const sites = Object.entries(MINE_SITES);
    expect(sites.length).toBe(3);
    for (const [id, s] of sites) {
      const b = lms[id]; expect(b, id).toBeTruthy();
      expect(Math.max(Math.abs(b.x), Math.abs(b.z)), id).toBeGreaterThan(PLATE + 10);
      const apron = { x: s.x, z: s.z, w: MINE_APRON, d: MINE_APRON, rot: 0 };
      expect(obbOverlap(apron, PARK_AREA, 2), id).toBe(false);
      expect(obbOverlap(apron, { x: (FARM_X0 + FARM_X1) / 2, z: (FARM_Z0 + FARM_Z1) / 2, w: FARM_X1 - FARM_X0, d: FARM_Z1 - FARM_Z0, rot: 0 }, 2), id).toBe(false);
      expect(s.x - MINE_APRON / 2).toBeGreaterThanOrEqual(MAP_BOUNDS.x0); expect(s.x + MINE_APRON / 2).toBeLessThanOrEqual(MAP_BOUNDS.x1);
      expect(s.z - MINE_APRON / 2).toBeGreaterThanOrEqual(MAP_BOUNDS.z0); expect(s.z + MINE_APRON / 2).toBeLessThanOrEqual(MAP_BOUNDS.z1);
      expect(propertyById(`lm:${id}`), id).toBeTruthy();
    }
    for (const [a, s] of sites) for (const [b, t] of sites) if (a < b) expect(Math.hypot(s.x - t.x, s.z - t.z)).toBeGreaterThan(120);
  });
});
