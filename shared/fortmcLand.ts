/**
 * Fort McChud land shape (map expansion), pure so the 2D map and tests can use it without three.js: the carved basins
 * (tailings ponds, lakes, Deep Ore Mine pit) and the ground height. The play area is exactly flat (y = 0); hills only
 * start 24 m past the map edge.
 */
import { FORT_X0, FORT_X1, FORT_Z0, FORT_Z1 } from './fortmc.js';

export interface FortWater { x: number; z: number; rx: number; rz: number; kind: 'lake' | 'tailings' }
/** Natural lakes sit outside the playable bounds (scenery); tailings ponds sit beside the plant. */
export const FORT_WATERS: FortWater[] = [
  { x: -10, z: 92, rx: 19, rz: 5.5, kind: 'tailings' },
  { x: 40, z: 92, rx: 16, rz: 5.5, kind: 'tailings' },
  { x: -262, z: -152, rx: 54, rz: 20, kind: 'lake' },
  { x: -485, z: -20, rx: 24, rz: 58, kind: 'lake' },
  { x: -150, z: 150, rx: 46, rz: 17, kind: 'lake' },
  { x: 40, z: -168, rx: 34, rz: 15, kind: 'lake' },
];
export const MINE_PIT = { x: 105, z: 20, r: 16, depth: 6.4 } as const;
const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Distance outside the playable rectangle (0 inside). */
export const outside = (x: number, z: number) => Math.hypot(Math.max(FORT_X0 - x, 0, x - FORT_X1), Math.max(FORT_Z0 - z, 0, z - FORT_Z1));
export const waterE = (w: FortWater, x: number, z: number) => ((x - w.x) / w.rx) ** 2 + ((z - w.z) / w.rz) ** 2;
/** Ground height. 0 everywhere a player can build; hills only start 24 m past the map edge. */
export function fortHeight(x: number, z: number): number {
  let h = 0; const d = outside(x, z);
  if (d > 24) {
    const hill = sstep(24, 170, d) * (10 + 6 * Math.sin(x * 0.013 + 1) * Math.cos(z * 0.011) + 4 * Math.sin(x * 0.041 - z * 0.033) + 2.5 * Math.sin(x * 0.09 + z * 0.07));
    const bay = sstep(30, 72, x) * sstep(84, 112, z); // keep the bay and river mouth open
    h = Math.max(0, hill) * (1 - bay);
  }
  if (x > 74 && z > 99) h = -3; // under the bay/river water
  const pr = Math.hypot(x - MINE_PIT.x, z - MINE_PIT.z); if (pr < MINE_PIT.r + 0.2) h = -MINE_PIT.depth - 0.6;
  for (const w of FORT_WATERS) { const e = waterE(w, x, z); if (e < 1.3) { const deep = w.kind === 'lake' ? -2 : -1.2; h = e < 1 ? Math.min(h, deep) : Math.min(h, deep + (h - deep) * sstep(1, 1.3, e)); } }
  return h;
}

