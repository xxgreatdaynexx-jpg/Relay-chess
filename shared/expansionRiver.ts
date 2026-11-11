/**
 * Goldwood River: a natural winding river through the Billionaire 2x land. It rises in the northern woods above
 * Goldwood's vineyards, runs south between the Big Farms and the East Estates, and meets the ocean east of the
 * shoreline dock. Pure geometry (no three.js) so roads, plots, scenery and tests share one shape. Decorative water:
 * nothing is buyable in it, and every road crossing is a bridge (shared/expansionRoads.ts).
 */
import { spline } from './worldLayout.js';

type P = [number, number];
/** Centreline control points, north (source) to south (mouth). */
const RIVER_CTRL: P[] = [
  [295, -452], [299, -436], [318, -412], [346, -392], [370, -366], [380, -336], [377, -304], [372, -272],
  [380, -240], [389, -206], [386, -172], [376, -138], [374, -104], [383, -70], [388, -36], [382, 0],
  [374, 34], [378, 68], [388, 100], [390, 132], [386, 162], [392, 200],
];
export const RIVER_MOUTH_Z = 200;
/** Resampled centreline (~2 units apart). */
export const RIVER_PTS: P[] = spline(RIVER_CTRL, false, 2);
/** Arc length along the centreline at each point. */
const ARC: number[] = (() => { const a = [0]; for (let i = 1; i < RIVER_PTS.length; i++) a.push(a[i - 1] + Math.hypot(RIVER_PTS[i][0] - RIVER_PTS[i - 1][0], RIVER_PTS[i][1] - RIVER_PTS[i - 1][1])); return a; })();
export const RIVER_LEN = ARC[ARC.length - 1];
/** Half width of the water at arc length s: a narrow creek at the source, widening toward the mouth, with gentle pools. */
export const riverHalfW = (s: number) => {
  const t = s / RIVER_LEN;
  const base = 4.2 + 4.2 * t;
  const pools = 0.9 * Math.sin(s / 37 + 0.6) + 0.5 * Math.sin(s / 13 + 2.1);
  const mouth = t > 0.93 ? (t - 0.93) / 0.07 * 5 : 0;
  return Math.max(3.4, base + pools + mouth);
};
const normalAt = (i: number): P => {
  const a = RIVER_PTS[Math.max(0, i - 1)], b = RIVER_PTS[Math.min(RIVER_PTS.length - 1, i + 1)];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  return [-dz / L, dx / L];
};
/** West/left bank and east/right bank polylines (north → south). */
export const RIVER_BANKS: { left: P[]; right: P[] } = (() => {
  const left: P[] = [], right: P[] = [];
  RIVER_PTS.forEach(([x, z], i) => { const [nx, nz] = normalAt(i); const h = riverHalfW(ARC[i]); left.push([x - nx * h, z - nz * h]); right.push([x + nx * h, z + nz * h]); });
  return { left, right };
})();
/** Closed water outline (counter-clockwise-ish): one bank down, the other back up. */
export const riverOutline = (): P[] => [...RIVER_BANKS.left, ...[...RIVER_BANKS.right].reverse()];

/** Nearest point on the centreline: distance, arc length, index. */
export function riverNearest(x: number, z: number): { d: number; s: number; i: number; px: number; pz: number } {
  let best = { d: Infinity, s: 0, i: 0, px: 0, pz: 0 };
  // cheap reject: the river lives in x 280..400
  for (let i = 1; i < RIVER_PTS.length; i++) {
    const a = RIVER_PTS[i - 1], b = RIVER_PTS[i]; const dx = b[0] - a[0], dz = b[1] - a[1]; const L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0; const px = a[0] + t * dx, pz = a[1] + t * dz;
    const d = Math.hypot(x - px, z - pz); if (d < best.d) best = { d, s: ARC[i - 1] + t * Math.sqrt(L2), i, px, pz };
  }
  return best;
}
/** Signed clearance from the water's edge: < 0 inside the water. */
export const riverClearance = (x: number, z: number) => {
  if (x < 270 || x > 420) return Infinity;
  const n = riverNearest(x, z); return n.d - riverHalfW(n.s);
};
export const inRiver = (x: number, z: number, m = 0) => riverClearance(x, z) < m;

/** Where a segment a→b crosses the river centreline (arc length along the segment 0..1), if it does. */
export function riverCrossings(a: P, b: P): Array<{ t: number; x: number; z: number; s: number }> {
  const out: Array<{ t: number; x: number; z: number; s: number }> = [];
  for (let i = 1; i < RIVER_PTS.length; i++) {
    const c = RIVER_PTS[i - 1], e = RIVER_PTS[i];
    const d1x = b[0] - a[0], d1z = b[1] - a[1], d2x = e[0] - c[0], d2z = e[1] - c[1];
    const den = d1x * d2z - d1z * d2x; if (Math.abs(den) < 1e-9) continue;
    const t = ((c[0] - a[0]) * d2z - (c[1] - a[1]) * d2x) / den, u = ((c[0] - a[0]) * d1z - (c[1] - a[1]) * d1x) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ t, x: a[0] + t * d1x, z: a[1] + t * d1z, s: ARC[i - 1] + u * Math.hypot(d2x, d2z) });
  }
  return out;
}

export interface RiverDecor { reeds: Array<[number, number, number]>; rocks: Array<[number, number, number]>; trees: Array<[number, number, number]> }
let decor: RiverDecor | null = null;
/** Reeds in the shallows, rocks on the bends, and riverbank trees (keep-out is applied by expansionScenery). */
export function riverDecor(): RiverDecor {
  if (decor) return decor;
  let seed = 9127; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const d: RiverDecor = { reeds: [], rocks: [], trees: [] };
  for (let i = 2; i < RIVER_PTS.length - 2; i++) {
    const [x, z] = RIVER_PTS[i]; const [nx, nz] = normalAt(i); const h = riverHalfW(ARC[i]);
    for (const side of [-1, 1]) {
      if (r() < 0.45) { const o = h - 0.6 - r() * 1.2; d.reeds.push([x + nx * o * side + (r() - 0.5), z + nz * o * side + (r() - 0.5), 0.7 + r() * 0.6]); }
      if (r() < 0.07) { const o = h + 0.4 + r() * 1.6; d.rocks.push([x + nx * o * side, z + nz * o * side, 0.5 + r() * 0.8]); }
      if (r() < 0.5) { const o = h + 4.5 + r() * 9; d.trees.push([x + nx * o * side + (r() - 0.5) * 2, z + nz * o * side + (r() - 0.5) * 2, 0.85 + r() * 0.7]); }
    }
  }
  return (decor = d);
}
