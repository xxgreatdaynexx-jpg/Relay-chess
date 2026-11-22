/**
 * Fort McChud flow-line routing (visual only, mu-visuals). Every tract's pipeline runs to the Upgrader & Refinery inlet
 * along orthogonal corridors: out the pad's east edge, down the gap between tract columns, along a shared trunk rack
 * north of the plant, then south into the inlet header. Each tract gets its own lane so lines run side by side, never
 * crossing diagonally. Gameplay (which tract feeds the plant, pipe tiers) is unaffected: this only draws the line.
 */
import { tractInfo } from './fortmc.js';
export const PLANT_INLET = { x: 10, z: 35 } as const;
export const PAD_W = 30, PAD_D = 26;
export type Pt = [number, number];
/** West Field lines (tracts 11-20) ride 1 m higher so they bridge over the east field's lanes where they cross. */
export const WEST_PIPE_LIFT = 1;
export function pipeRoute(n: number): Pt[] {
  if (n > 10) { // West Field: same pattern, then a long trunk lane between the north pads and the main road into the inlet
    const t = tractInfo(n), k = n - 11, col = k % 5, row = Math.floor(k / 5) % 2;
    const gapX = t.x + PAD_W / 2 + 3.5 + (row ? 1.4 : -1.4);
    const trunkZ = -14 - col * 2 - row;
    const dropX = PLANT_INLET.x - 4 + k; // half a metre beside the east field's stubs
    const startZ = t.z + (row ? 6 : -6);
    return [[t.x + PAD_W / 2 - 2, startZ], [gapX, startZ], [gapX, trunkZ], [dropX, trunkZ], [dropX, PLANT_INLET.z]];
  }
  const t = tractInfo(n), col = (n - 1) % 5, row = Math.floor((n - 1) / 5);
  const gapX = t.x + PAD_W / 2 + 3.5 + (row ? 1.4 : -1.4); // between this column and the next
  const trunkZ = 6 + col * 2 + row * 1; // distinct trunk lane per tract
  const dropX = PLANT_INLET.x - 4.5 + (n - 1); // distinct inlet stub per tract
  const startZ = t.z + (row ? 6 : -6);
  return [[t.x + PAD_W / 2 - 2, startZ], [gapX, startZ], [gapX, trunkZ], [dropX, trunkZ], [dropX, PLANT_INLET.z]];
}
