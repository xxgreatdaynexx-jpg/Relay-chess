/**
 * Countryside around the plate: rural roads linking the outskirts mines, fields, farmhouses, a hamlet with a gas
 * station, an industrial yard by The Mine, a lake, hills, rocks and forest. Purely decorative (nothing here is
 * buyable). Deterministic so every client draws the same map. Keeps clear of the plate, the farm district, the mines
 * and the spaces RESERVED_VENUES holds for the Airport and Speedway.
 */
import { PLATE, MINE_SITES, MINE_APRON, OUTSKIRTS, RESERVED_VENUES, ROADS, type House } from './worldLayout.js';
import { housingType } from './housing.js';
import { JAIL_SITE, JAIL_HALF } from './jail.js';
import { inCivic } from './city.js';
import { FARM_X0, FARM_X1, FARM_Z0, FARM_Z1, FARM_LANES, FARM_LANE_W } from './farm.js';
import { AIRPORT_ROADS, RACETRACK_ROADS } from './venues.js';
const VENUE_ROADS = [...AIRPORT_ROADS, ...RACETRACK_ROADS];

type P = [number, number];
export interface Box2 { x: number; z: number; w: number; d: number }
export interface OutBuilding extends Box2 { h: number; kind: 'farmhouse' | 'barn' | 'warehouse' | 'gas' | 'shed'; rot: number; /** Existing field bundled with this barn; metadata only. */ farmId?: string }
export interface OutField extends Box2 { crop: number; /** generation index (stable cf:<n> id) */ n: number }
export const RURAL_ROAD_W = 4.5;
const NZ = -PLATE - 8, WX = -PLATE - 5, EX = 196, SZ = 150; // the ring of rural roads around the plate + farm
/**
 * Rural roads: straight runs, square corners (each is [from, to]). A ring road round the plate and the farm (north road
 * at NZ, west road at WX, east road at EX, south "far shore" road at SZ); every city road that runs off the plate edge
 * gets a short stub on to the west road (west side) or the farm's west lane (east side); the speedway access and the
 * airport access are venue roads (shared/venues.ts) that the ring meets at T junctions. Every end is a junction or a
 * destination (an apron, the industrial yard); see tests/road-network.test.ts.
 */
export const RURAL_ROADS: Array<[P, P]> = [
  [[-80, NZ], [WX, NZ]], [[0, NZ], [EX, NZ]], // north road (the speedway access road is the stretch between x=-80 and 0)
  [[EX, NZ], [EX, SZ]], [[WX, NZ], [WX, SZ]], [[WX, SZ], [EX, SZ]], // east, west and south roads
  [[128, NZ], [128, -150.5]], // north road down to the Fishing Dock's gravel path (DOCK.path)
  [[WX, -54], [-181, -54]], // industrial yard west of The Mine (between its warehouses)
  [[EX, 96], [MINE_SITES['mine-magma'].x + MINE_APRON / 2, 96]], // paved spur from the east road to Magma Depths' apron
  // city roads that run off the plate's east / west edge continue to the farm's west lane / the west road
  ...ROADS.flatMap((r) => (r.closed || !r.ends ? [] : r.ends.flatMap((e, i): Array<[P, P]> => {
    const p = i === 0 ? r.pts[0] : r.pts[r.pts.length - 1]; if (e !== 'edge' || Math.abs(Math.abs(p[0]) - PLATE) > 0.5) return [];
    const z = Math.round(p[1] * 10) / 10; if (AIRPORT_ROADS.some(([a]) => Math.hypot(a[0] - p[0], a[1] - z) < 3)) return []; // the airport road continues shore-w
    return [[[Math.sign(p[0]) * PLATE, z], [p[0] > 0 ? FARM_LANES[0][0][0] : WX, z]]];
  }))),
];
export const LAKE = { x: 128, z: -187, rx: 30, rz: 16 };
/** Shore radius factor at angle a (0..1 of rx/rz): a few low, smooth lobes and a cove by the dock (north shore, +z). */
const lakeK = (a: number) => 0.87 + 0.06 * Math.sin(2 * a + 0.9) + 0.04 * Math.sin(3 * a + 2.4) - 0.025 * Math.cos(5 * a + 0.3);
/** Lake outline: a smooth organic ring of 96 points (world xz), counter-clockwise from +x. */
export const lakeShape = (): P[] => Array.from({ length: 96 }, (_, i) => { const a = (i / 96) * Math.PI * 2; const k = lakeK(a); return [LAKE.x + Math.cos(a) * LAKE.rx * k, LAKE.z + Math.sin(a) * LAKE.rz * k] as P; });
/** True inside the water (with margin m, + = bigger). */
export const inLake = (x: number, z: number, m = 0) => { const dx = (x - LAKE.x) / LAKE.rx, dz = (z - LAKE.z) / LAKE.rz; const a = Math.atan2(dz, dx); const k = lakeK(a); const r = Math.hypot(dx * LAKE.rx, dz * LAKE.rz); const R = Math.hypot(Math.cos(a) * LAKE.rx * k, Math.sin(a) * LAKE.rz * k); return r < R + m; };
/** Fishing dock on the north shore: boathouse pad (= the 'dock' landmark, 12x12) between the road and the water, a pier out into the lake and a short gravel path up to the road. */
export const DOCK = { x: 128, z: -161, pierZ1: -167, pierZ0: -183, pierW: 3, path: [[128, -150.5], [128, -155]] as [P, P] };
export const DOCK_BOX = { x0: DOCK.x - 8, x1: DOCK.x + 8, z0: DOCK.pierZ0 - 1, z1: -149 };
const inR = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number, m: number) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
const segD = (x: number, z: number, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };
const inBox = (b: Box2, x: number, z: number, m: number) => Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m;
/** True where decor must not go (m = clearance). */
export function keepOut(x: number, z: number, m = 0): boolean {
  return genKeepOut(x, z, m) || inJail(x, z, m) || inCivic(x, z, m); // civic district (City Hall buildings): like the jail, never part of the seeded fill
}
/** Inside the jail compound (pt1495u) with clearance m. */
export const inJail = (x: number, z: number, m = 0) => Math.abs(x - JAIL_SITE.x) < JAIL_HALF.x + 2 + m && Math.abs(z - JAIL_SITE.z) < JAIL_HALF.z + 2 + m;
/** keepOut exactly as the countryside fill used it before the jail (pre-411b76c): the jail must never feed into the
 * seeded fill, or every later field / farmhouse shifts and cf:<n> ids point at different fields (pt1495u). */
function genKeepOut(x: number, z: number, m = 0): boolean {
  if (!inR({ x0: OUTSKIRTS.x0 + 2, x1: OUTSKIRTS.x1 - 2, z0: OUTSKIRTS.z0 + 2, z1: OUTSKIRTS.z1 - 2 }, x, z, -m)) return true;
  if (Math.abs(x) < PLATE + 3 + m && Math.abs(z) < PLATE + 3 + m) return true;
  if (inR({ x0: FARM_X0, x1: FARM_X1, z0: FARM_Z0, z1: FARM_Z1 }, x, z, 3 + m)) return true;
  for (const r of Object.values(RESERVED_VENUES)) if (inR(r, x, z, 2 + m)) return true;
  for (const s of Object.values(MINE_SITES)) {
    if (Math.abs(x - s.x) < MINE_APRON / 2 + 2 + m && Math.abs(z - s.z) < MINE_APRON / 2 + 2 + m) return true;
    const pts: P[] = [...s.track, [s.x, s.z]]; for (let i = 1; i < pts.length; i++) if (segD(x, z, pts[i - 1], pts[i]) < 3.5 + m) return true;
  }
  for (const [a, b] of RURAL_ROADS) if (segD(x, z, a, b) < RURAL_ROAD_W / 2 + 1.5 + m) return true;
  for (const ln of FARM_LANES) if (segD(x, z, ln[0], ln[ln.length - 1]) < FARM_LANE_W / 2 + 1.5 + m) return true;
  for (const [a, b, w] of VENUE_ROADS) if (segD(x, z, a, b) < w / 2 + 1.5 + m) return true; // Airport / Speedway access roads (shared/venues.ts)
  if (inLake(x, z, 4 + m)) return true; // water + a clean grass/sand bank all round
  if (inR(DOCK_BOX, x, z, 1 + m)) return true;
  return false;
}
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export interface LakeDecor { reeds: Array<[number, number, number]>; lilies: Array<[number, number, number]>; rocks: Array<[number, number, number]> }
export interface Outskirts { lake: LakeDecor; buildings: OutBuilding[]; fields: OutField[]; trees: Array<[number, number, number]>; rocks: Array<[number, number, number]>; hills: Array<[number, number, number, number]>; lamps: P[]; tanks: P[]; pumps: P[] }
let cache: Outskirts | null = null;
export function outskirts(): Outskirts {
  if (cache) return cache;
  const r = rng(20261101); const buildings: OutBuilding[] = []; const fields: OutField[] = []; const tanks: P[] = []; const pumps: P[] = [];
  const free = (b: Box2, m: number) => [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]].every(([u, v]) => !genKeepOut(b.x + (u * b.w) / 2, b.z + (v * b.d) / 2, m))
    && ![...buildings, ...fields].some((o) => Math.abs(o.x - b.x) < (o.w + b.w) / 2 + m && Math.abs(o.z - b.z) < (o.d + b.d) / 2 + m);
  const put = (b: OutBuilding, m = 1) => { if (free(b, m)) { buildings.push(b); return true; } return false; };
  // Industrial yard west of The Mine: sheds, warehouses and tanks around the road's end.
  put({ x: -192, z: -44, w: 16, d: 10, h: 6, kind: 'warehouse', rot: 0 }); put({ x: -192, z: -16, w: 14, d: 9, h: 5, kind: 'warehouse', rot: 0 });
  put({ x: -210, z: -30, w: 8, d: 14, h: 4, kind: 'shed', rot: 0 }); put({ x: -192, z: -64, w: 18, d: 10, h: 7, kind: 'warehouse', rot: 0 });
  for (const t of [[-208, -54], [-208, -62], [-200, -76]] as P[]) if (!genKeepOut(t[0], t[1], 2)) tanks.push(t);
  // Hamlet on the far shore road: detached homes (city 'house' type and size) both sides, facing the road.
  const HOUSE = housingType('house'); const home = (x: number, z: number, rot: number) => { const w = 2.8 + r() * 0.4, d = 2.8 + r() * 0.4;
    return put({ x, z, w, d, h: HOUSE.floorH * (r() < 0.5 ? 1 : 2), kind: 'farmhouse', rot }, 0.8); };
  for (let x = -100; x <= 112; x += 7) for (const side of [-1, 1]) { if (Math.abs(x - 60) < 12 || r() < 0.25) continue; home(x, 150 + side * 6.5, side > 0 ? Math.PI : 0); }
  const gas = (x: number, z: number, rot: number) => { if (put({ x, z, w: 10, d: 8, h: 3.2, kind: 'gas', rot }, 0.5)) pumps.push([x, z]); };
  gas(60, 160, Math.PI); gas(186, 112, Math.PI / 2); gas(142, -138, Math.PI);
  // Fields with a farmhouse + barn: south band, the strip north of the farm, the west gap and around the lake.
  const fieldIn = (x0: number, x1: number, z0: number, z1: number, n: number) => { for (let k = 0, tries = 0; k < n && tries < n * 30; tries++) {
    const w = 14 + Math.floor(r() * 4) * 4, d = 10 + Math.floor(r() * 3) * 4; const f: OutField = { x: x0 + w / 2 + r() * Math.max(0, x1 - x0 - w), z: z0 + d / 2 + r() * Math.max(0, z1 - z0 - d), w, d, crop: Math.floor(r() * 4), n: fields.length };
    if (!free(f, 2)) continue; fields.push(f); k++;
    if (r() < 0.7) { const sd = r() < 0.5 ? -1 : 1; const bx = f.x + (f.w / 2 + 4.5) * sd; if (put({ x: bx, z: f.z - 3, w: 6, d: 4.5, h: 3.4, kind: 'barn', rot: 0, farmId: `cf:${f.n}` })) home(bx, f.z + 3.5, sd > 0 ? -Math.PI / 2 : Math.PI / 2); } } };
  fieldIn(-115, 140, 162, 190, 9); fieldIn(-115, 140, 122, 140, 6); fieldIn(70, 194, -144, -120, 4); fieldIn(-218, -126, -122, -64, 4);
  fieldIn(150, 206, 120, 190, 3); fieldIn(-218, -126, 150, 190, 3); fieldIn(-26, 190, -214, -154, 5);
  // Hills along the far edges, rocks near the mines.
  const hills: Array<[number, number, number, number]> = []; for (let t = 0; hills.length < 22 && t < 400; t++) {
    const e = Math.floor(r() * 4); const u = r(); const x = e < 2 ? OUTSKIRTS.x0 + 8 + u * (OUTSKIRTS.x1 - OUTSKIRTS.x0 - 16) : e === 2 ? OUTSKIRTS.x0 + 10 : OUTSKIRTS.x1 - 10;
    const z = e === 0 ? OUTSKIRTS.z0 + 10 : e === 1 ? OUTSKIRTS.z1 - 10 : OUTSKIRTS.z0 + 8 + u * (OUTSKIRTS.z1 - OUTSKIRTS.z0 - 16); const rad = 7 + r() * 7;
    if (!genKeepOut(x, z, rad) && ![...fields, ...buildings].some((o) => inBox(o, x, z, rad))) hills.push([x, z, rad, 3 + r() * 5]); }
  const rocks: Array<[number, number, number]> = []; for (const s of Object.values(MINE_SITES)) for (let t = 0, n = 0; n < 14 && t < 200; t++) {
    const a = r() * Math.PI * 2, d = MINE_APRON / 2 + 4 + r() * 16; const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
    if (!genKeepOut(x, z, 0.5) && ![...buildings, ...fields].some((o) => inBox(o, x, z, 1))) { rocks.push([x, z, 0.6 + r() * 1.4]); n++; } }
  // Forest: clumps scattered over whatever is left.
  const trees: Array<[number, number, number]> = []; const clear = (x: number, z: number) => !genKeepOut(x, z, 0.5) && ![...buildings, ...fields].some((o) => inBox(o, x, z, 1.5)) && !hills.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr * 0.8);
  for (let c = 0; c < 420; c++) { const cx = OUTSKIRTS.x0 + r() * (OUTSKIRTS.x1 - OUTSKIRTS.x0), cz = OUTSKIRTS.z0 + r() * (OUTSKIRTS.z1 - OUTSKIRTS.z0); if (!clear(cx, cz)) continue;
    const n = 6 + Math.floor(r() * 14), sp = 5 + r() * 8; for (let i = 0; i < n; i++) { const x = cx + (r() - 0.5) * 2 * sp, z = cz + (r() - 0.5) * 2 * sp; if (clear(x, z)) trees.push([x, z, 0.8 + r() * 0.9]); } }
  // Lakeside: reed beds and lily pads in sheltered bays, a few shore rocks, and a loose ring of trees back from the
  // bank (never in the water, on the dock or its path).
  const lake: LakeDecor = { reeds: [], lilies: [], rocks: [] }; const shore = lakeShape(); const byDock = (x: number, z: number) => Math.abs(x - DOCK.x) < 10 && z > LAKE.z;
  shore.forEach(([x, z], i) => { const dx = x - LAKE.x, dz = z - LAKE.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L; if (byDock(x, z)) return;
    const bed = Math.sin(i * 0.37) > 0.35; // reed beds come in runs along the shore
    if (bed) for (let k = 0; k < 3; k++) { const o = -0.6 + r() * 1.4, t = (r() - 0.5) * 1.2; lake.reeds.push([x + ux * o - uz * t, z + uz * o + ux * t, 0.7 + r() * 0.6]); }
    if (bed && r() < 0.35) { const o = -2 - r() * 3; lake.lilies.push([x + ux * o, z + uz * o, 0.45 + r() * 0.4]); }
    if (!bed && r() < 0.12) lake.rocks.push([x + ux * (0.6 + r()), z + uz * (0.6 + r()), 0.5 + r() * 0.7]); });
  for (let i = 0; i < 70; i++) { const a = r() * Math.PI * 2, k = lakeK(a), d = 6 + r() * 8; const x = LAKE.x + Math.cos(a) * (LAKE.rx * k + d), z = LAKE.z + Math.sin(a) * (LAKE.rz * k + d);
    if (!byDock(x, z) && clear(x, z) && !inLake(x, z, 5)) trees.push([x, z, 0.9 + r() * 0.8]); }
  // Road lamps every 18 units, alternating sides.
  const lamps: P[] = []; for (const [a, b] of RURAL_ROADS) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    for (let s = 9, k = 0; s < L; s += 18, k++) { const o = (k % 2 ? 1 : -1) * (RURAL_ROAD_W / 2 + 0.8); const lx = a[0] + ux * s - uz * o, lz = a[1] + uz * s + ux * o; if (!Object.values(RESERVED_VENUES).some((r) => lx >= r.x0 && lx <= r.x1 && lz >= r.z0 && lz <= r.z1) && !VENUE_ROADS.some(([p, q, w]) => segD(lx, lz, p, q) < w / 2 + 0.6)) lamps.push([lx, lz]); } }
  // The jail compound (pt1495u) took the south-east corner: drop the field (cf:21), its barn and farmhouse, and any
  // trees / rocks / hills on the yard. Done after the fill so nothing else moves and every other id stays the same.
  const hitsJail = (o: Box2) => Math.abs(o.x - JAIL_SITE.x) < JAIL_HALF.x + 2 + o.w / 2 && Math.abs(o.z - JAIL_SITE.z) < JAIL_HALF.z + 2 + o.d / 2;
  const pt = <T extends [number, number, ...number[]]>(a: T[]) => a.filter((p) => !inJail(p[0], p[1], 1 + (p.length > 2 ? Number(p[2]) : 0)) && !inCivic(p[0], p[1], 1 + (p.length > 2 ? Number(p[2]) : 0)));
  cache = { lake, buildings: buildings.filter((b) => !hitsJail(b)), fields: fields.filter((f) => !hitsJail(f)), trees: pt(trees), rocks: pt(rocks), hills: pt(hills), lamps: lamps.filter(([x, z]) => !inJail(x, z, 0.5) && !inCivic(x, z, 0.5)), tanks, pumps }; return cache;
}

const HOUSE_COLORS = housingType('house').colors;
/** Countryside homes as city-style detached homes (buyable: same ids, pricing and deeds as city houses). */
export const countryHomes = (): House[] => outskirts().buildings.filter((b) => b.kind === 'farmhouse').map((b, i) => ({ x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, h: b.h, type: 'house', color: HOUSE_COLORS[i % HOUSE_COLORS.length] }));
/** Buyable country businesses: gas stations and the industrial yard's warehouses. */
export const COMMERCIAL_PRICE: Record<string, number> = { gas: 60_000, depot: 90_000 };
export const COMMERCIAL_LABEL: Record<string, string> = { gas: 'Gas station', depot: 'Industrial warehouse' };
/** Property type of a country business ('depot' so it never reads as the Warehouse landmark). */
export const businessType = (b: OutBuilding) => (b.kind === 'warehouse' ? 'depot' : 'gas');
export const countryBusinesses = () => outskirts().buildings.filter((b) => b.kind === 'gas' || b.kind === 'warehouse');
