/**
 * West Chud's countryside and wooded blocks, planted exactly like the old map's open land (shared/expansionScenery.ts):
 * a jittered 4.1 grid kept where the forest-stand noise is high (pines and broadleaf in separate stands, a soft fringe,
 * bushes and rocks under them), and lone trees, bushes and rocks scattered over the clearings. Drawn by the same
 * instanced meshes (client/src/lib/worldExpansionDecor.ts). The built-up town gets the old city's own street trees instead.
 */
import { forestNoise, type ScenerySpot } from './expansionScenery.js';
import { obbHit, type OBB } from './worldLayout.js';
import { WEST, WEST_RESERVED, WEST_PORT, WEST_MARINA, WEST_WAREHOUSES, WIND_X, WEST_LIGHTHOUSE, westFill, westRoadClearance, westTown, onWest, WEST_FARMS, WEST_HILLS, WEST_LAKES, WEST_CREEK, WEST_CREEK_W, nearWater, lakeOutline, WEST_DECOR_SOLIDS } from './westCity.js';
import { WEST_ACTIVITY_SOLIDS } from './westActivities.js';

const hash2 = (i: number, j: number) => { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const vnoise = (x: number, z: number) => { const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j; const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
const mulberry = (a: number) => () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** West Chud is mostly countryside, so its stands start a touch lower on the same noise than the old map's (0.41). */
const FOREST_T = 0.40;
let cache: ScenerySpot[] | null = null;
export function westScenery(): ScenerySpot[] {
  if (cache) return cache;
  const { houses, patches } = westFill(); const rnd = mulberry(0x5bd1e995);
  const solids: OBB[] = [...houses, ...patches, ...WEST_WAREHOUSES, ...WEST_RESERVED, WEST_PORT, WEST_MARINA, ...WEST_FARMS, ...WEST_DECOR_SOLIDS, ...WEST_ACTIVITY_SOLIDS]; // fields, yards, hamlets, lakeside, meadows and outcrops stay open
  const G = 24; const grid = new Map<string, OBB[]>();
  for (const o of solids) { const r = Math.hypot(o.w, o.d) / 2 + 3; for (let i = Math.floor((o.x - r) / G); i <= Math.floor((o.x + r) / G); i++) for (let j = Math.floor((o.z - r) / G); j <= Math.floor((o.z + r) / G); j++) { const k = `${i},${j}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(o); } }
  const clearOf = (x: number, z: number, rad: number, roadGap = 1.6) => {
    if (!onWest(x, z, 2) || z > WEST.z1 - 7 || westTown(x, z)) return false; // off the beach (old rule: beach line - 7) and out of town
    if (westRoadClearance(x, z) < rad + roadGap) return false;
    if (nearWater(x, z, rad + 0.8) || WEST_HILLS.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + rad)) return false; // lakes, the creek, the hills
    if (Math.abs(x - WIND_X) < 8 || Math.hypot(x - WEST_LIGHTHOUSE[0], z - WEST_LIGHTHOUSE[1]) < 10) return false;
    for (const o of grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) ?? []) if (obbHit(o, x, z, rad + 1.4)) return false;
    return true;
  };
  const spots: ScenerySpot[] = [];
  // forest: jittered grid, kept where the stand noise is high; pines and broadleaf in separate stands
  const STEP = 4.1;
  for (let gx = Math.ceil(WEST.x0 / STEP) * STEP; gx < WEST.x1; gx += STEP) for (let gz = Math.ceil(WEST.z0 / STEP) * STEP; gz < WEST.z1; gz += STEP) {
    const x = gx + (hash2(Math.round(gx * 7), Math.round(gz * 3)) - 0.5) * STEP * 0.9, z = gz + (hash2(Math.round(gz * 5), Math.round(gx * 11)) - 0.5) * STEP * 0.9;
    const n = forestNoise(x, z);
    const edge = n - FOREST_T; if (edge < -0.06) continue; if (edge < 0.02 && hash2(Math.round(x * 13), Math.round(z * 17)) > 0.3) continue;
    const scale = 0.85 + hash2(Math.round(x * 3), Math.round(z * 29)) * 0.65 + Math.max(0, edge) * 0.6;
    if (!clearOf(x, z, 1.3 * scale)) continue;
    const conifer = vnoise(x / 48 - 30, z / 48 + 17) > 0.52;
    spots.push({ kind: conifer ? 'pine' : 'deciduous', x, z, s: scale, rot: hash2(Math.round(x * 31), Math.round(z * 7)) * Math.PI * 2 });
    if (hash2(Math.round(x * 41), Math.round(z * 43)) < 0.12) { const bx = x + 2.2, bz = z - 1.4; if (clearOf(bx, bz, 0.7)) spots.push({ kind: 'bush', x: bx, z: bz, s: 0.6 + rnd() * 0.4, rot: rnd() * Math.PI }); }
    if (hash2(Math.round(x * 53), Math.round(z * 59)) < 0.035) { const rx = x - 1.8, rz = z + 1.6; if (clearOf(rx, rz, 0.6)) spots.push({ kind: 'rock', x: rx, z: rz, s: 0.5 + rnd() * 0.6, rot: rnd() * Math.PI }); }
  }
  // meadow scatter: lone trees and bushes in the clearings so open land is never bare
  for (let x = WEST.x0 + 5; x < WEST.x1 - 5; x += 19) for (let z = WEST.z0 + 5; z < WEST.z1 - 5; z += 19) {
    const jx = x + (rnd() - 0.5) * 14, jz = z + (rnd() - 0.5) * 14; if (forestNoise(jx, jz) > FOREST_T + 0.03) continue;
    const k = rnd(); const kind: ScenerySpot['kind'] = k < 0.35 ? 'deciduous' : k < 0.5 ? 'pine' : k < 0.85 ? 'bush' : 'rock';
    const sc = kind === 'bush' ? 0.6 + rnd() * 0.5 : kind === 'rock' ? 0.5 + rnd() * 0.6 : 0.8 + rnd() * 0.5;
    if (clearOf(jx, jz, kind === 'deciduous' || kind === 'pine' ? 1.3 * sc : 0.7)) spots.push({ kind, x: jx, z: jz, s: sc, rot: rnd() * Math.PI * 2 });
  }
  // shorelines: reeds (the big lake's clumps), the odd rock and a willow round the lakes; reeds along the creek banks
  for (const l of WEST_LAKES) for (const [i, [px, pz]] of lakeOutline(l, Math.round(l.rx + l.rz)).entries()) {
    const dx = px - l.x, dz = pz - l.z, m = Math.hypot(dx, dz) || 1; const x = px + (dx / m) * (2.5 + rnd() * 3), z = pz + (dz / m) * (2.5 + rnd() * 3);
    const kind: ScenerySpot['kind'] = i % 5 === 0 ? 'rock' : i % 3 === 0 ? 'deciduous' : 'reed';
    if (clearOf(x, z, kind === 'deciduous' ? 1.3 : 0.7)) spots.push({ kind, x, z, s: kind === 'deciduous' ? 0.9 + rnd() * 0.4 : 0.6 + rnd() * 0.5, rot: rnd() * Math.PI * 2 });
  }
  for (let i = 2; i < WEST_CREEK.length - 2; i += 3) { const [ax, az] = WEST_CREEK[i - 1], [bx, bz] = WEST_CREEK[i + 1]; const m = Math.hypot(bx - ax, bz - az) || 1; const nx = -(bz - az) / m, nz = (bx - ax) / m;
    for (const sd of [1, -1]) { if (rnd() < 0.45) continue; const [x0, z0] = WEST_CREEK[i]; const x = x0 + nx * sd * (WEST_CREEK_W / 2 + 0.6), z = z0 + nz * sd * (WEST_CREEK_W / 2 + 0.6);
      if (onWest(x, z, 2) && z < WEST.z1 - 7 && westRoadClearance(x, z) > 3 && !westTown(x, z)) spots.push({ kind: 'reed', x, z, s: 0.8 + rnd() * 0.5, rot: 0 }); } }
  // rocks on the hill skirts
  for (const [hx, hz, hr] of WEST_HILLS) for (let k = 0; k < 3; k++) { const a = rnd() * Math.PI * 2; const x = hx + Math.cos(a) * (hr + 1.5), z = hz + Math.sin(a) * (hr + 1.5); if (clearOf(x, z, 0.7)) spots.push({ kind: 'rock', x, z, s: 0.6 + rnd() * 0.6, rot: rnd() * Math.PI }); }
  cache = spots; return spots;
}
