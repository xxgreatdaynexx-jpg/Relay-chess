/**
 * Fort McChud flow-line routing (visual only, mu-visuals). Every tract's pipeline runs to the Upgrader & Refinery inlet
 * along orthogonal corridors: out the pad's east edge, down the gap between tract columns, along a shared trunk rack
 * north of the plant, then south into the inlet header. Each tract gets its own lane so lines run side by side, never
 * crossing diagonally. Gameplay (which tract feeds the plant, pipe tiers) is unaffected: this only draws the line.
 */
import { tractInfo } from './fortmc';
export const PLANT_INLET = { x: 10, z: 35 } as const;
export const PAD_W = 30, PAD_D = 26;
export type Pt = [number, number];
export function pipeRoute(n: number): Pt[] {
  const t = tractInfo(n), col = (n - 1) % 5, row = Math.floor((n - 1) / 5);
  const gapX = t.x + PAD_W / 2 + 3.5 + (row ? 1.4 : -1.4); // between this column and the next
  const trunkZ = 6 + col * 2 + row * 1; // distinct trunk lane per tract
  const dropX = PLANT_INLET.x - 4.5 + (n - 1); // distinct inlet stub per tract
  const startZ = t.z + (row ? 6 : -6);
  return [[t.x + PAD_W / 2 - 2, startZ], [gapX, startZ], [gapX, trunkZ], [dropX, trunkZ], [dropX, PLANT_INLET.z]];
}
