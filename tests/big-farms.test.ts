import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { registerPgAdvisoryFunctions } from './pg-advisory';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Farm } from '../server/farm';
import { cropById } from './farm-helpers';
import { bigFarms, bigFarmPrice, BIG_ROADS, BIG_FARM_AREA, BIG_TILE, BIG_LANE_X, BIG_ROAD_W, BIG_FARM_N0, BIG_NORTH_ROAD_Z, BIG_EAST_X, BIG_GROUND_X0, BIG_GROUND_X1, BIG_GROUND_Z0 } from '../shared/bigFarms';
import { allFieldPlots, fieldPlotOf } from '../shared/fieldFarms';
import { outskirts, RURAL_ROADS, RURAL_ROAD_W, inLake } from '../shared/outskirts';
import { TILE, MAP_BOUNDS, MAP_VIEW, clampMapTarget, farmPlots } from '../shared/farm';
import { propertyById, properties } from '../shared/realEstate';
import { LAUNCH as LAUNCH_POPUP } from '../shared/launchPopup';
import { MINE_SITES, MINE_APRON, OUTSKIRTS, PLATE } from '../shared/worldLayout';

const inside = (o: { x: number; z: number; w: number; d: number }, b: { x0: number; x1: number; z0: number; z1: number }) => o.x - o.w / 2 >= b.x0 && o.x + o.w / 2 <= b.x1 && o.z - o.d / 2 >= b.z0 && o.z + o.d / 2 <= b.z1;
const overlap = (a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
const segD = (x: number, z: number, a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dz = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };

describe('Big Farms map expansion', () => {
  it('12 large farms (20x20 / 24x24 / 30x30), all east of the east road, fenced lots that never overlap', () => {
    const f = bigFarms(); expect(BIG_TILE).toBe(TILE);
    expect(f).toHaveLength(12); expect(new Set(f.map((x) => x.size))).toEqual(new Set([20, 24, 30]));
    for (const p of f) {
      expect(p.cols).toBeGreaterThanOrEqual(20); expect(p.cols).toBe(p.rows); expect(p.w).toBe(p.cols * TILE + 2);
      expect(p.x - p.w / 2).toBeGreaterThan(196 + RURAL_ROAD_W); // east of the ring's east road
      const lot = { x: (p.lot.x0 + p.lot.x1) / 2, z: (p.lot.z0 + p.lot.z1) / 2, w: p.lot.x1 - p.lot.x0, d: p.lot.z1 - p.lot.z0 };
      for (const o of [p, { ...p.barn }, { ...p.house }]) expect(inside(o, p.lot)).toBe(true);
      expect(overlap(p, p.barn)).toBe(false); expect(overlap(p, p.house)).toBe(false); expect(overlap(p.barn, p.house)).toBe(false);
      for (const q of f) if (q !== p) expect(overlap(lot, { x: (q.lot.x0 + q.lot.x1) / 2, z: (q.lot.z0 + q.lot.z1) / 2, w: q.lot.x1 - q.lot.x0, d: q.lot.z1 - q.lot.z0 })).toBe(false);
      for (const m of p.machines) expect(m.z).toBeGreaterThan(p.lot.z0); // machinery parks in the yard, outside the fence
      for (const m of p.machines) expect(Math.abs(m.z - (p.z - p.d / 2))).toBeGreaterThan(3);
    }
    const original = [
      { n: 1000, size: 30, x: 240, z: -75, lot: { x0: 209, x1: 271, z0: -118, z1: -44 } },
      { n: 1001, size: 24, x: 240, z: -4, lot: { x0: 209, x1: 271, z0: -41, z1: 21 } },
      { n: 1002, size: 20, x: 240, z: 57, lot: { x0: 209, x1: 271, z0: 24, z1: 78 } },
      { n: 1003, size: 24, x: 240, z: 118, lot: { x0: 209, x1: 271, z0: 81, z1: 143 } },
      { n: 1004, size: 20, x: 310, z: -85, lot: { x0: 279, x1: 341, z0: -118, z1: -64 } },
      { n: 1005, size: 30, x: 310, z: -18, lot: { x0: 279, x1: 341, z0: -61, z1: 13 } },
      { n: 1006, size: 20, x: 310, z: 49, lot: { x0: 279, x1: 341, z0: 16, z1: 70 } },
      { n: 1007, size: 24, x: 310, z: 110, lot: { x0: 279, x1: 341, z0: 73, z1: 135 } },
    ];
    for (const e of original) {
      const p = f.find((x) => x.n === e.n)!;
      expect(p).toMatchObject(e);
    }
  });
  it('roads: every farm has a driveway onto the lane, the lane and new east road meet the existing ring; no road crosses a field', () => {
    const ring = RURAL_ROADS.slice(0, 6);
    const lanes = BIG_ROADS.filter(([a, b]) => a[0] === BIG_LANE_X && b[0] === BIG_LANE_X);
    const lane = lanes[0]!;
    for (const end of lane) expect(BIG_ROADS.some(([a, b]) => a !== lane[0] && segD(end[0], end[1], a, b) < 0.01 && !(a === lane[0] && b === lane[1]))).toBe(true);
    // the north / south extensions start on the existing east road (x = 196)
    for (const [a] of BIG_ROADS.slice(0, 2)) expect(ring.some(([p, q]) => segD(a[0], a[1], p, q) < 0.01)).toBe(true);
    for (const p of bigFarms()) {
      expect(lanes.some(([a, b]) => segD(p.drive[0][0], p.drive[0][1], a, b) < 0.01)).toBe(true);
      for (const [a, b] of BIG_ROADS) for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) expect(segD(p.x + (u * p.w) / 2, p.z + (v * p.d) / 2, a, b)).toBeGreaterThan(BIG_ROAD_W / 2);
    }
  });
  it('the old countryside fill is untouched: no outskirts field, building or road reaches into the expansion', () => {
    const O = outskirts(); const A = BIG_FARM_AREA;
    for (const o of [...O.fields, ...O.buildings]) for (const p of bigFarms()) expect(overlap(o, p)).toBe(false);
    expect(O.fields.every((f) => f.n < BIG_FARM_N0)).toBe(true);
    expect(allFieldPlots().filter((p) => p.n >= BIG_FARM_N0 && p.n < 2000)).toHaveLength(12);
    for (const [a, b] of RURAL_ROADS) expect(Math.max(a[0], b[0])).toBeLessThan(A.x0);
  });
  it('pricing: expensive and scaling faster than size; listed as buyable farmland cf:<n>', () => {
    expect(bigFarmPrice(400)).toBe(145_000); expect(bigFarmPrice(576)).toBe(235_000); expect(bigFarmPrice(900)).toBe(450_000);
    expect(bigFarmPrice(900) / 900).toBeGreaterThan(bigFarmPrice(400) / 400);
    for (const p of bigFarms()) {
      const pr = propertyById(`cf:${p.n}`)!; expect(pr.kind).toBe('farm'); expect(pr.price).toBe(bigFarmPrice(p.cols * p.rows));
      expect(pr.label).toMatch(/^Big Farm #\d+ \(\d+×\d+\)$/); expect(fieldPlotOf(`cf:${p.n}`)!.cols).toBe(p.cols);
    }
    const smallMax = Math.max(...properties().filter((p) => p.kind === 'farm' && !/^cf:[12]\d{3}$/.test(p.id) && !p.id.startsWith('winery:') && p.map !== 'resort').map((p) => p.price));
    expect(bigFarmPrice(400)).toBeGreaterThan(smallMax);
    expect(farmPlots().length).toBeGreaterThan(0);
  });
  it('map bounds, camera clamp and the popup include the expansion', () => {
    expect(MAP_BOUNDS.x1).toBeGreaterThanOrEqual(BIG_FARM_AREA.x1); expect(MAP_VIEW.x1).toBeGreaterThanOrEqual(BIG_FARM_AREA.x1);
    expect(MAP_BOUNDS.z0).toBeLessThanOrEqual(BIG_FARM_AREA.z0);
    for (const p of bigFarms()) {
      expect(p.lot.z0).toBeGreaterThanOrEqual(MAP_BOUNDS.z0); expect(p.lot.z1).toBeLessThanOrEqual(MAP_BOUNDS.z1);
      const [x, z] = clampMapTarget(p.x, p.z); expect(x).toBe(p.x); expect(z).toBe(p.z);
    }
    expect(JSON.stringify(LAUNCH_POPUP)).toContain('Big Farms east of town');
  });
  it('buy a big farm: debits its price, deed value = price paid (net worth / wealth tax basis), then farm it like any field', async () => {
    const db = newDb({ noAstCoverageCheck: true }); registerPgAdvisoryFunctions(db); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    const clock = () => Date.parse('2026-11-04T12:00:00Z');
    const re = new RealEstate(pool, () => bank, clock); await re.init();
    const farm = new Farm(pool, () => bank, clock); await farm.init();
    const p = bigFarms().find((f) => f.size === 20)!; const id = `cf:${p.n}`;
    bank.transfer('Gus', 1_000_000, { game: 'admin' }); await bank.flush();
    const before = bank.account('Gus').chips;
    const bought = await re.buy('Gus', id);
    expect(bought.price).toBeGreaterThanOrEqual(bigFarmPrice(400));
    expect(before - bank.account('Gus').chips).toBe(bought.price);
    const m = (await re.mine('Gus')).find((o) => o.id === id)!;
    expect(m.paid).toBe(bought.price); expect(m.value).toBe(bought.price);
    expect((await re.playerValue()).value).toBe(bought.price);
    await farm.plant('Gus', id, 'wheat', [0, 1, 399]);
    const m2 = (await re.mine('Gus')).find((o) => o.id === id)!;
    expect(m2.cropValue).toBe(cropById('wheat')!.seed * 3); expect(m2.value).toBe(bought.price + cropById('wheat')!.seed * 3);
  });

  it('northern plots sit on clear land: no overlap with roads, lakes, buildings, the quarry or other farms', () => {
    const f = bigFarms();
    const O = outskirts();
    const q = MINE_SITES['mine-quarry']!;
    const keep = MINE_APRON / 2 + 4;
    const north = f.filter((p) => p.n >= 1008);
    expect(north).toHaveLength(4);
    expect(north.map((p) => p.size)).toEqual([24, 30, 20, 24]);
    for (const p of north) expect(p.lot.z1).toBeLessThan(-124); // entirely north of the original north road
    for (const p of f) {
      expect(!(p.lot.x1 <= q.x - keep || p.lot.x0 >= q.x + keep || p.lot.z1 <= q.z - keep || p.lot.z0 >= q.z + keep)).toBe(false);
      for (let x = p.lot.x0; x <= p.lot.x1; x += 6) for (let z = p.lot.z0; z <= p.lot.z1; z += 6) expect(inLake(x, z, 4), `lake ${p.n}`).toBe(false);
    }
    for (const [hx, hz, hr] of O.hills) for (const p of f) {
      const cx = Math.max(p.lot.x0, Math.min(hx, p.lot.x1));
      const cz = Math.max(p.lot.z0, Math.min(hz, p.lot.z1));
      expect(Math.hypot(hx - cx, hz - cz)).toBeGreaterThanOrEqual(hr);
    }
    for (const o of [...O.fields, ...O.buildings]) for (const p of f) {
      const lot = { x: (p.lot.x0 + p.lot.x1) / 2, z: (p.lot.z0 + p.lot.z1) / 2, w: p.lot.x1 - p.lot.x0, d: p.lot.z1 - p.lot.z0 };
      expect(overlap(o, lot)).toBe(false);
    }
    for (const p of north) {
      for (const [a, b] of [...RURAL_ROADS, ...BIG_ROADS.filter((s) => s !== p.drive)]) {
        for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          // driveway is allowed to meet the lane; field corners and lot corners must stay off every other road
          expect(segD(p.x + (u * p.w) / 2, p.z + (v * p.d) / 2, a, b)).toBeGreaterThan(BIG_ROAD_W / 2);
        }
      }
      expect(p.lot.z0).toBeGreaterThan(BIG_FARM_AREA.z0);
      expect(p.lot.x0).toBeGreaterThan(BIG_FARM_AREA.x0);
      expect(p.lot.x1).toBeLessThan(BIG_FARM_AREA.x1);
    }
  });
  it('the new north road joins the east ring, and city grass covers the northern lots with a margin', () => {
    // first four roads stay put (original loop); a new north–south segment closes the west end of the north road
    expect(BIG_ROADS.slice(0, 4)).toEqual([
      [[196, -124], [BIG_EAST_X, -124]], [[196, 150], [BIG_EAST_X, 150]], [[BIG_EAST_X, -124], [BIG_EAST_X, 150]], [[BIG_LANE_X, -124], [BIG_LANE_X, 150]],
    ]);
    const onSeg = (x: number, z: number, a: [number, number], b: [number, number]) => segD(x, z, a, b) < 0.01;
    expect(BIG_ROADS.some(([a, b]) => onSeg(196, BIG_NORTH_ROAD_Z, a, b) && onSeg(196, -124, a, b))).toBe(true);
    const src = readFileSync(new URL('../client/src/lib/world3d.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/BIG_GROUND_X1, gz0, z1/);
    expect(src).toMatch(/BIG_GROUND_X0, x1, gz0, z0/);
    expect(src).toContain('xmasGround(b0 - a0, f - e');
    const { x0, x1, z0, z1 } = OUTSKIRTS; const P = PLATE;
    const gz0 = Math.min(z0, BIG_GROUND_Z0);
    const strips: Array<[number, number, number, number]> = [[x0, x1, z0, -P], [x0, x1, P, z1], [x0, -P, -P, P], [P, x1, -P, P], [x1, BIG_GROUND_X1, gz0, z1], [BIG_GROUND_X0, x1, gz0, z0]];
    const onGround = (x: number, z: number) => strips.some(([a, b, e, f]) => x >= a && x <= b && z >= Math.min(e, f) && z <= Math.max(e, f));
    for (const p of bigFarms()) {
      for (const [x, z] of [[p.lot.x0, p.lot.z0], [p.lot.x1, p.lot.z0], [p.lot.x0, p.lot.z1], [p.lot.x1, p.lot.z1], [p.barn.x, p.barn.z]] as const) {
        expect(onGround(x, z), `cf:${p.n} at ${x},${z}`).toBe(true);
      }
    }
    // north road, including its west end at the east ring, plus a margin past the road
    for (const x of [196, BIG_LANE_X, BIG_EAST_X]) {
      expect(onGround(x, BIG_NORTH_ROAD_Z)).toBe(true);
      expect(onGround(x, BIG_NORTH_ROAD_Z - 6)).toBe(true);
    }
    expect(BIG_GROUND_X0).toBeLessThan(196 - 8);
    expect(BIG_GROUND_X1).toBeGreaterThan(BIG_FARM_AREA.x1);
    expect(BIG_GROUND_Z0).toBe(BIG_FARM_AREA.z0);
  });
});