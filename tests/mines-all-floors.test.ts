import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { MineGear, depthKey } from '../server/mineGear';
import { MinesWorld } from '../server/mines';
import { CAVES, ORES, inExit, type CaveId, type OreId } from '../shared/mines';
import { canStand } from '../shared/fps';
import { LADDER, MAX_FLOOR, caveBandOf, caveFloorBias, floorKey, floorRows, hasFloors, levelOf } from '../shared/mineFloors';

const ALL: CaveId[] = ['mine', 'frost', 'magma', 'coral'];
const OTHERS: CaveId[] = ['frost', 'magma', 'coral'];
const value = (c: CaveId, f: number) => { const n = levelOf(c, f).nodes; return n.reduce((t, x) => t + ORES[x.ore].price, 0) / n.length; };

describe('every mine gets the descent (Nov 4)', () => {
  it('all caves have floors, an elevator and a ladder', () => { for (const c of ALL) expect(hasFloors(c)).toBe(true); });
  it('floor 1 of each cave is that cave, unchanged', () => { for (const c of ALL) { expect(levelOf(c, 1).nodes).toEqual(CAVES[c].nodes); expect(levelOf(c, 1).map).toBe(CAVES[c].map); } });
  it('The Mine floors are byte-identical to before (seed + rows untouched)', () => { expect(floorRows(7, 'mine')).toEqual(floorRows(7)); });
  it('each cave floor connects the lift to the ladder', () => {
    for (const c of OTHERS) for (let f = 2; f <= MAX_FLOOR; f++) {
      const rows = floorRows(f, c); const H = rows.length, W = rows[0].length; const seen = new Set<string>();
      const sp = levelOf(c, f).map.spawns[0]; const q: Array<[number, number]> = [[Math.floor(sp[0] / 2), Math.floor(sp[1] / 2)]];
      while (q.length) { const [x, y] = q.pop()!; const k = `${x},${y}`; if (seen.has(k) || x < 0 || y < 0 || x >= W || y >= H || rows[y][x] === '#' || rows[y][x] === '~') continue; seen.add(k); q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
      expect(seen.has(`${Math.floor(LADDER.cx / 2)},${Math.floor(LADDER.cy / 2)}`), `${c} floor ${f}`).toBe(true);
      expect(canStand(LADDER.cx, LADDER.cy, 0, levelOf(c, f).map)).toBe(true);
    }
  });
  it('caves keep their own ore tables: no ore appears that the cave did not have', () => {
    for (const c of OTHERS) {
      const allowed = new Set<string>([...CAVES[c].nodes.map((n) => n.ore), ...Object.entries(CAVES[c].bias).filter(([, v]) => v! > 0).map(([o]) => o)]);
      for (const f of [2, 10, 25, 40]) for (const n of levelOf(c, f).nodes) expect(allowed.has(n.ore), `${c} f${f} ${n.ore}`).toBe(true);
      for (const f of [2, 40]) for (const [o, v] of Object.entries(caveFloorBias(c, f)) as Array<[OreId, number]>) if (!CAVES[c].bias[o]) expect(v).toBe(0);
    }
    for (const c of ['mine', 'frost', 'magma'] as CaveId[]) for (const f of [2, 20, 40]) for (const n of levelOf(c, f).nodes) expect(['opal', 'pearl']).not.toContain(n.ore);
  });
  it('deeper is richer in every cave, and each cave keeps its look/names', () => {
    for (const c of OTHERS) { expect(value(c, 30)).toBeGreaterThan(value(c, 2)); expect(caveBandOf(c, 2).theme.lamp).toBe(CAVES[c].theme.lamp); expect(levelOf(c, 12).name).toContain(CAVES[c].name); }
  });
  it('floor state is per cave: separate rocks and creatures, harder deeper', () => {
    const w = new MinesWorld();
    expect(w.mobsOn(5, 'magma')).not.toBe(w.mobsOn(5, 'mine'));
    expect(w.nodeStates('frost', 4)).not.toBe(w.nodeStates('mine', 4));
    expect(floorKey('mine', 4)).toBe(4); expect(floorKey('coral', 4)).toBe('coral:4');
    const hp = (f: number) => Math.max(...w.mobsOn(f, 'coral').map((b) => b.max));
    expect(w.mobsOn(3, 'coral').length).toBeGreaterThan(0); expect(hp(35)).toBeGreaterThan(hp(3));
  });
  it('descend, elevator and combat work in a non-Mine cave', () => {
    const w = new MinesWorld(); w.gearOf = () => ({ weapon: 'diamond_saber', armor: 'none' });
    const m = w.join('c1', null, 1000, 'magma'); let t = 5000;
    for (let f = 2; f <= 5; f++) { Object.assign(m, { x: LADDER.cx, y: LADDER.cy }); t += 1000; expect(w.descend('c1', t)).toBe(f); }
    expect(inExit(m.x, m.y)).toBe(true); t += 1000; expect(w.ride('c1', 1, t)).toBe(1); t += 1000; expect(w.ride('c1', 5, t)).toBe(5);
    const mob = w.mobsOn(5, 'magma').find((b) => !b.deadUntil)!; Object.assign(m, { x: mob.x - 1.2, y: mob.y, z: 0 });
    const r = w.attack('c1', mob.id, t + 3000); expect(r.killed).toBe(true);
    for (const s of r.loot ?? []) expect(CAVES.magma.bias[s.id as OreId]).toBeGreaterThan(0);
  });
  it('deepest floor is saved per cave (The Mine keeps the old key)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    const gear = new MineGear(pool, () => bank, () => 1_000); await gear.init();
    gear.recordDepth('Rex', 12); gear.recordDepth('Rex', 6, 'coral'); await gear.flush();
    expect(gear.deepestOf('Rex')).toBe(12); expect(gear.deepestOf('Rex', 'coral')).toBe(6); expect(gear.deepestOf('Rex', 'frost')).toBe(1);
    expect(depthKey('rex', 'mine')).toBe('rex'); expect(depthKey('rex', 'coral')).toBe('rex#coral');
  });
});
