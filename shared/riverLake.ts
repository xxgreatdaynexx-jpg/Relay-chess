/**
 * The big lake between the city's south shore and the far-shore fields. The north shore IS worldLayout.shoreZ (the
 * city, its roads and car bounds depend on it); the south shore, the rounded ends and an island are free-form and stay
 * inside the plate, so nothing in the outskirts moves. Deterministic (fixed seed). Decorative only.
 */
import { PLATE, shoreZ } from './worldLayout.js';

type P = [number, number];
const HL = 104; // half length: water spans x -HL..HL, grass beyond to the plate edge
const OFF = 15; // the ends close on the line shoreZ + OFF
const taper = (x: number) => Math.sqrt(Math.max(0, 1 - Math.abs(x / HL) ** 5));
/** South-side half width (from the closing line): coves and points. */
const southW = (x: number) => 15 + 4.2 * Math.sin(x / 19 + 0.7) + 2.6 * Math.sin(x / 7.3 + 2.2) + 1.6 * Math.sin(x / 3.1 + 0.4) - 5.5 * Math.exp(-(((x - 38) / 7) ** 2)) + 4 * Math.exp(-(((x + 62) / 9) ** 2));
export const riverNorthZ = (x: number) => shoreZ(x) + OFF - taper(x) * OFF;
export const riverSouthZ = (x: number) => Math.min(PLATE - 2.5, shoreZ(x) + OFF + taper(x) * Math.max(7, southW(x)));

let outlineCache: P[] | null = null;
/** Closed outline, counter-clockwise in (x, z): north shore west → east, then the south shore back. */
export function riverOutline(): P[] {
  if (outlineCache) return outlineCache;
  const xs: number[] = []; const N = 120; for (let i = 0; i <= N; i++) xs.push(-HL * Math.cos((i / N) * Math.PI));
  const north = xs.map((x): P => [x, riverNorthZ(x)]), south = xs.slice(1, -1).reverse().map((x): P => [x, riverSouthZ(x)]);
  return (outlineCache = [...north, ...south]);
}
/** Small wooded island (a hole in the water). */
export const ISLAND = { x: -58, z: 88, rx: 7, rz: 4 };
export function islandOutline(): P[] {
  const out: P[] = []; for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, w = 1 + 0.14 * Math.sin(a * 3 + 1) + 0.08 * Math.sin(a * 5); out.push([ISLAND.x + Math.cos(a) * ISLAND.rx * w, ISLAND.z + Math.sin(a) * ISLAND.rz * w]); }
  return out;
}
export function inPoly(x: number, z: number, pts: P[]): boolean {
  let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
  return c;
}
/** Open water (not the island). */
export const inRiverLake = (x: number, z: number) => inPoly(x, z, riverOutline()) && !inPoly(x, z, islandOutline());
/** Distance from (x, z) to the nearest edge of a closed outline. */
export function edgeDist(x: number, z: number, pts: P[]): number {
  let d = Infinity; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [ax, az] = pts[j], [bx, bz] = pts[i]; const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz; const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0; d = Math.min(d, Math.hypot(x - ax - t * dx, z - az - t * dz)); }
  return d;
}

export interface RiverDecor { reeds: Array<[number, number, number]>; rocks: Array<[number, number, number]>; trees: Array<[number, number, number]>; lilies: Array<[number, number, number]> }
let decorCache: RiverDecor | null = null;
/** Reeds and lilies in the shallows, rocks on points, trees on the south bank, the ends and the island (never in the city: z > shoreZ + 1). */
export function riverDecor(): RiverDecor {
  if (decorCache) return decorCache;
  let s = 7331; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const o = riverOutline(), isl = islandOutline(); const d: RiverDecor = { reeds: [], rocks: [], trees: [], lilies: [] };
  const landOk = (x: number, z: number) => Math.abs(x) < PLATE - 1.5 && z < PLATE - 1.5 && z > shoreZ(x) + 1.2 && !inPoly(x, z, o);
  const walk = (pts: P[], outward: number, onIsland = false) => pts.forEach(([x, z], i) => {
    const [ax, az] = pts[(i + pts.length - 1) % pts.length], [bx, bz] = pts[(i + 1) % pts.length]; let nx = bz - az, nz = -(bx - ax); const L = Math.hypot(nx, nz) || 1; nx = (nx / L) * outward; nz = (nz / L) * outward;
    const north = z <= shoreZ(x) + 0.5; // city waterfront: keep it clear (promenade trees already line it)
    if (!north && r() < 0.45) for (let k = 0; k < 3; k++) { const t = -0.4 - r() * 1.6, sd = (r() - 0.5) * 1.6; d.reeds.push([x + nx * t - nz * sd, z + nz * t + nx * sd, 0.7 + r() * 0.6]); }
    if (!north && r() < 0.12) d.lilies.push([x - nx * (3 + r() * 3), z - nz * (3 + r() * 3), 0.45 + r() * 0.4]);
    if (r() < 0.1) d.rocks.push([x + nx * (0.3 + r() * 0.8), z + nz * (0.3 + r() * 0.8), 0.4 + r() * 0.6]);
    if (r() < 0.55) { const t = (onIsland ? 1.6 : 3.5) + r() * (onIsland ? 1.5 : 6), tx = x + nx * t, tz = z + nz * t; if (onIsland ? inPoly(tx, tz, isl) : landOk(tx, tz)) d.trees.push([tx, tz, 0.7 + r() * 0.5]); }
  });
  const ccw = (pts: P[]) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]); return a > 0 ? 1 : -1; };
  walk(o, ccw(o)); // outward normal for the lake
  walk(isl, ccw(isl), true); // island: "outward" from the water = into the island
  for (let i = 0; i < 6; i++) d.trees.push([ISLAND.x + (r() - 0.5) * ISLAND.rx, ISLAND.z + (r() - 0.5) * ISLAND.rz * 0.9, 0.8 + r() * 0.4]);
  // the grass at the lake ends and the strip to the plate edge gets a few copses
  for (let i = 0; i < 160; i++) { const x = (r() - 0.5) * 2 * (PLATE - 2), z = shoreZ(x) + 2 + r() * (PLATE - shoreZ(x)); if (landOk(x, z) && edgeDist(x, z, o) > 3) d.trees.push([x, z, 0.7 + r() * 0.5]); }
  return (decorCache = d);
}
