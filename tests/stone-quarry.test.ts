import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CAVES, CAVE_DEFS, isCave, inExit, type OreId } from '../shared/mines';
import { levelOf, floorRows, hasFloors, caveFloorBias, MAX_FLOOR, LADDER } from '../shared/mineFloors';
import { mobCount, MOB_SKINS } from '../shared/mineCombat';
import { JOBS, isMinerCave, MINER_CAVES, jobById, rollOre, minerItemEv, MINER_BIAS } from '../shared/employment';
import { CITY_CAVES, parseLoc, mineLoc, WAREHOUSE } from '../shared/inventoryLocations';
import { MinesWorld } from '../server/mines';
import { canStand } from '../shared/fps';
import { LANDMARK_IDS, MINE_SITES, MINE_APRON } from '../shared/worldLayout';
import { inLake } from '../shared/outskirts';
import { bigFarms } from '../shared/bigFarms';
import { CAVE_LANDMARK, ROYALTY_VENUE } from '../shared/royalty';
import { LANDMARK_PRICE, properties } from '../shared/realEstate';

const root = dirname(fileURLToPath(import.meta.url));

describe('Stone Quarry (chessguy2)', () => {
  it('is a registered city cave with floors and only-stone generation', () => {
    expect(isCave('quarry')).toBe(true);
    expect(hasFloors('quarry')).toBe(true);
    expect(CAVE_DEFS.map((c) => c.id)).toContain('quarry');
    expect(CAVES.quarry.name).toMatch(/Stone Quarry/i);
    expect(MINE_SITES['mine-quarry']?.cave).toBe('quarry');
    expect(MINE_SITES['mine-quarry']?.x).toBeGreaterThan(300); // east / top-right above Big Farms
    expect(MINE_SITES['mine-quarry']?.z).toBeLessThan(-130); // north of the original Big Farm lots, on the east road
    const q = MINE_SITES['mine-quarry']!;
    expect(q.x).toBe(328); expect(q.z).toBe(-158);
    expect(inLake(q.x, q.z, MINE_APRON / 2 + 4)).toBe(false);
    for (let a = 0; a < 32; a++) {
      const ang = (a * Math.PI) / 16, r = MINE_APRON / 2;
      expect(inLake(q.x + Math.cos(ang) * r, q.z + Math.sin(ang) * r, 2), `apron lake ${a}`).toBe(false);
    }
    for (const f of bigFarms()) {
      const onLot = q.x > f.lot.x0 - MINE_APRON / 2 && q.x < f.lot.x1 + MINE_APRON / 2 && q.z > f.lot.z0 - MINE_APRON / 2 && q.z < f.lot.z1 + MINE_APRON / 2;
      expect(onLot, `lot ${f.n}`).toBe(false);
      const onCrop = Math.abs(q.x - f.x) < f.w / 2 + MINE_APRON / 2 && Math.abs(q.z - f.z) < f.d / 2 + MINE_APRON / 2;
      expect(onCrop, `crop ${f.n}`).toBe(false);
    }
    const keep = MINE_APRON / 2 + 4;
    for (const f of bigFarms()) {
      const overlap = !(f.lot.x1 <= q.x - keep || f.lot.x0 >= q.x + keep || f.lot.z1 <= q.z - keep || f.lot.z0 >= q.z + keep);
      expect(overlap, `quarry keep-out vs lot ${f.n}`).toBe(false);
    }
    expect(CAVE_LANDMARK.quarry).toBeUndefined();
    expect(ROYALTY_VENUE['mine-quarry']).toBeUndefined();
    expect(LANDMARK_IDS).toContain('mine-quarry'); // map/apron placement only
    expect(LANDMARK_PRICE['mine-quarry']).toBeUndefined();
    expect(properties().some((p) => p.id === 'lm:mine-quarry')).toBe(false);
    // Quarry must not reshuffle countryside cf:* / barn catalogs (bottom-left farms restored to pre-quarry geometry).
    const cf24 = properties().find((p) => p.id === 'cf:24')!;
    expect(cf24.x).toBeCloseTo(-167.5098, 3);
    expect(cf24.z).toBeCloseTo(159.4744, 3);
    expect(properties().some((p) => p.id === 'cf:31')).toBe(true);
    expect(properties().some((p) => p.id === 'barn:country:30')).toBe(true);
    for (const f of [1, 5, 20, 40]) {
      const bias = caveFloorBias('quarry', f);
      for (const [ore, w] of Object.entries(bias)) {
        if (ore === 'stone') expect(w).toBeGreaterThan(0);
        else expect(w ?? 0).toBe(0);
      }
      const nodes = levelOf('quarry', f).nodes;
      expect(nodes.length).toBeGreaterThan(10);
      for (const n of nodes) expect(n.ore).toBe('stone');
      expect(mobCount(f, 'quarry')).toBe(0);
    }
    expect(caveFloorBias('quarry', 40).stone!).toBeGreaterThan(caveFloorBias('quarry', 1).stone!);
  });

  it('every floor connects the lift to the ladder', () => {
    for (let f = 2; f <= MAX_FLOOR; f++) {
      const rows = floorRows(f, 'quarry'); const H = rows.length, W = rows[0].length; const seen = new Set<string>();
      const sp = levelOf('quarry', f).map.spawns[0]; const q: Array<[number, number]> = [[Math.floor(sp[0] / 2), Math.floor(sp[1] / 2)]];
      while (q.length) {
        const [x, y] = q.pop()!; const k = `${x},${y}`;
        if (seen.has(k) || x < 0 || y < 0 || x >= W || y >= H || rows[y][x] === '#' || rows[y][x] === '~') continue;
        seen.add(k); q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      expect(seen.has(`${Math.floor(LADDER.cx / 2)},${Math.floor(LADDER.cy / 2)}`), `floor ${f}`).toBe(true);
      expect(canStand(LADDER.cx, LADDER.cy, 0, levelOf('quarry', f).map)).toBe(true);
    }
  });

  it('has exhaustive mob skins but never spawns hostiles', () => {
    expect(Object.keys(MOB_SKINS.quarry).length).toBeGreaterThanOrEqual(6);
    const w = new MinesWorld();
    const m = w.join('q1', 'Quarrier', 1000, 'quarry');
    expect(m.cave).toBe('quarry');
    expect(inExit(m.x, m.y)).toBe(true);
    expect(w.mobsOn(3, 'quarry')).toHaveLength(0);
    expect(w.mobsOn(40, 'quarry')).toHaveLength(0);
  });

  it('offers Miner · Stone Quarry (stone-only) alongside the other three miner jobs', () => {
    expect(MINER_CAVES).toEqual(['mine', 'frost', 'magma', 'quarry']);
    expect(isMinerCave('quarry')).toBe(true);
    const job = jobById('miner:quarry');
    expect(job?.cave).toBe('quarry');
    expect(job?.label).toMatch(/Stone Quarry/i);
    expect(MINER_BIAS.quarry.label).toMatch(/Only Stone/i);
    expect(minerItemEv('quarry')).toBeCloseTo(0.1, 9);
    const u = (() => { let s = 3; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
    for (let i = 0; i < 200; i++) expect(rollOre('quarry', u)).toBe('stone');
    expect(JOBS.filter((j) => j.kind === 'miner').map((j) => j.cave).sort()).toEqual(['frost', 'magma', 'mine', 'quarry']);
    const src = readFileSync(join(root, '../server/employment.ts'), 'utf8');
    expect(src).not.toMatch(/Workers can't be sent to the Stone Quarry/);
  });

  it('manual gather of stone works and banks toward the city warehouse pool', () => {
    expect((CITY_CAVES as readonly string[])).toContain('quarry');
    expect(mineLoc('quarry')).toBe(WAREHOUSE);
    expect(parseLoc('mine:quarry').ref).toBe('quarry');
    const w = new MinesWorld();
    const m = w.join('q2', 'Stony', 1000, 'quarry');
    const before = w.load(m.id);
    const given = w.giveOre(m, 5, () => 'stone' as OreId);
    expect(given).toEqual([{ type: 'ore', id: 'stone', qty: 5 }]);
    expect(w.load(m.id)).toBe(before + 5);
    expect([...m.carried.values()].some((s) => s.id === 'stone' && s.qty === 5)).toBe(true);
  });

  it('existing three city mines still spawn mixed ores, hostiles and worker jobs', () => {
    for (const cave of ['mine', 'frost', 'magma'] as const) {
      const ores = new Set(levelOf(cave, 1).nodes.map((n) => n.ore));
      expect(ores.size).toBeGreaterThan(1);
      expect(isMinerCave(cave)).toBe(true);
      expect(jobById(`miner:${cave}`)?.cave).toBe(cave);
      expect(mobCount(10, cave)).toBeGreaterThan(0);
    }
  });
});
