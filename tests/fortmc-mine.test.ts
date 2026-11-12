import { describe, expect, it } from 'vitest';
import { MinesWorld } from '../server/mines';
import { CAVES, CAVE_DEFS, ORES, ORE_ORDER, inExit, isCave, isOre, type CaveId, type OreId } from '../shared/mines';
import { canStand } from '../shared/fps';
import { LADDER, MAX_FLOOR, caveBandOf, floorRows, hasFloors, levelOf } from '../shared/mineFloors';
import { FORT_FEED, FORT_SPOTS, UNITS, newFort, unloadHaul } from '../shared/fortmc';
import { depthKey } from '../server/mineGear';
import { FortMc } from '../server/fortmc';
import { LAUNCH as LAUNCH_POPUP } from '../shared/launchPopup';

const FORT_ORES: OreId[] = ['oilsand', 'shale', 'tarrock', 'condensate'];

describe('Fort McChud walk-in mine (Nov 4)', () => {
  it('is a cave with floors, its own look and a map entrance', () => {
    expect(isCave('fortmc')).toBe(true); expect(hasFloors('fortmc')).toBe(true);
    expect(CAVE_DEFS.map((c) => c.id)).toContain('fortmc');
    expect(caveBandOf('fortmc', 2).theme.lamp).toBe(CAVES.fortmc.theme.lamp); expect(levelOf('fortmc', 12).name).toContain('Fort McChud Mine');
    expect(FORT_SPOTS.find((s) => s.id === 'f-shaft')).toBeTruthy(); expect(FORT_SPOTS.find((s) => s.id === 'f-mine')).toBeTruthy(); // idle Deep Ore Mine kept
  });
  it('every floor connects the lift to the ladder', () => {
    for (let f = 2; f <= MAX_FLOOR; f++) {
      const rows = floorRows(f, 'fortmc'); const H = rows.length, W = rows[0].length; const seen = new Set<string>();
      const sp = levelOf('fortmc', f).map.spawns[0]; const q: Array<[number, number]> = [[Math.floor(sp[0] / 2), Math.floor(sp[1] / 2)]];
      while (q.length) { const [x, y] = q.pop()!; const k = `${x},${y}`; if (seen.has(k) || x < 0 || y < 0 || x >= W || y >= H || rows[y][x] === '#' || rows[y][x] === '~') continue; seen.add(k); q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
      expect(seen.has(`${Math.floor(LADDER.cx / 2)},${Math.floor(LADDER.cy / 2)}`), `floor ${f}`).toBe(true);
      expect(canStand(LADDER.cx, LADDER.cy, 0, levelOf('fortmc', f).map)).toBe(true);
    }
  });
  it('industrial ores are exclusive to the Fort McChud Mine and spawn there', () => {
    for (const o of FORT_ORES) { expect(isOre(o)).toBe(true); expect(ORE_ORDER).toContain(o); expect(ORES[o].exclusive).toBe(true); }
    const seen = new Set<string>(); for (const f of [1, 5, 20, 40]) for (const n of levelOf('fortmc', f).nodes) seen.add(n.ore);
    for (const o of FORT_ORES) expect(seen.has(o), o).toBe(true);
    for (const c of ['mine', 'frost', 'magma', 'coral', 'quarry'] as CaveId[]) for (const f of [1, 2, 20, 40]) for (const n of levelOf(c, f).nodes) expect(FORT_ORES).not.toContain(n.ore);
  });
  it('each industrial ore feeds an existing Fort McChud unit recipe', () => {
    const inputs = new Set(Object.values(UNITS).flatMap((u) => [u.input, (u as { alt?: string }).alt].filter(Boolean)));
    for (const o of FORT_ORES) { const f = FORT_FEED[o]!; expect(f, o).toBeTruthy(); expect(inputs.has(f[0]), `${o} -> ${f[0]}`).toBe(true); }
  });
  it('unloading moves feed ores into the tanks and other ores into the ore bin', () => {
    const s = newFort(0); const took = unloadHaul(s, new Map([['ore:oilsand', 10], ['ore:shale', 3], ['ore:tarrock', 2], ['ore:condensate', 1], ['ore:coal', 5], ['weapon:x', 1]]));
    expect(s.stock.crude).toBe(10); expect(s.stock.rawgas).toBe(6); expect(s.stock.residue).toBe(4); expect(s.stock.ngl).toBe(2); expect(s.ore.coal).toBe(5);
    expect(took.map(([k]) => k)).not.toContain('weapon:x');
  });
  it('banking in the Fort McChud Mine goes to the fort bin, with its own depth and cave switching', () => {
    const w = new MinesWorld(); const seen: Array<[string, number]> = []; w.fortBin = (_a, st) => { for (const s of st) seen.push([`${s.type}:${s.id}`, s.qty]); return []; };
    w.gearOf = () => ({ weapon: 'diamond_saber', armor: 'none' });
    const m = w.join('f1', 'Rex', 1000, 'fortmc'); expect(m.cave).toBe('fortmc'); expect(inExit(m.x, m.y)).toBe(true);
    let t = 5000; for (let f = 2; f <= 4; f++) { Object.assign(m, { x: LADDER.cx, y: LADDER.cy }); t += 1000; expect(w.descend('f1', t)).toBe(f); }
    const hp = (f: number) => Math.max(...w.mobsOn(f, 'fortmc').map((b) => b.max)); expect(hp(35)).toBeGreaterThan(hp(3));
    m.carried.set('ore:oilsand', { type: 'ore', id: 'oilsand', qty: 4 } as never);
    t += 1000; expect(w.ride('f1', 1, t)).toBe(1);
    const r = w.exit('f1'); expect(r.bin).toBe('fortmc'); expect(seen).toEqual([['ore:oilsand', 4]]);
    w.moveToCave(m, 'frost'); expect(m.floor).toBe(1); expect(w.deepestOf(m)).toBe(1);
    expect(depthKey('rex', 'fortmc')).toBe('rex#fortmc');
  });
  it('the fort unload op empties the mine bin into the plant tanks', async () => {
    const f = new FortMc(null, () => 1_000, () => ({ write: async () => {}, after: () => {} }) as never, async () => {});
    const bin = new Map<string, number>([['ore:oilsand', 7], ['ore:iron', 2]]);
    f.haul = { read: async () => new Map(bin), take: (_n, items) => { for (const [k, q] of items) bin.set(k, (bin.get(k) ?? 0) - q); return []; } };
    await f.act('Rex', { op: 'unload' });
    const inv = await f.inventory('Rex'); expect(inv.stock.crude).toBe(7); expect(inv.ore.iron).toBe(2); expect(bin.get('ore:oilsand')).toBe(0);
    await expect(f.act('Rex', { op: 'unload' })).rejects.toThrow(/Nothing to unload/);
  });
});
