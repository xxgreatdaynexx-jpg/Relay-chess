/**
 * mu-visuals containers: a neat, grid-snapped container yard (pure layout, no three.js so it is unit-testable).
 * Every box has the same orientation (long axis along the quay = world X), sits on a fixed slot grid, stacks are flush
 * (each tier exactly one box height above the last, the bottom tier on the quay deck), max 3 high, nothing overlaps.
 * Proportions follow ISO: 40ft = 12.19 × 2.44 × 2.59 m, 20ft = 6.06 m long, at scale k = 0.512 world units per metre.
 */
export const CK = 0.512;
export const C40 = { len: 12.19 * CK, w: 2.44 * CK, h: 2.59 * CK } as const;
export const C20 = { len: 6.06 * CK, w: 2.44 * CK, h: 2.59 * CK } as const;
/** Muted, realistic liner colours. */
export const CONTAINER_COLORS = [0x8a3b2a, 0x3d6f8f, 0x2b3d5a, 0x4a6b4a, 0x8a9096, 0x6b4a32, 0xb8a88a, 0xb5652d, 0xd4d2c8, 0x5a2a2a] as const;
export interface Box { x: number; y: number; z: number; size: 20 | 40; color: number; logo: boolean }
export interface YardOpts { x0: number; x1: number; z0: number; z1: number; deckY: number; seed?: number; maxTier?: number }
const GAP_X = 0.5, GAP_Z = 0.3, LANE = 2.2;
/** Lay out boxes inside [x0,x1]×[z0,z1] on the deck. Rows run along X (parallel to the quay); pairs of rows share a lane. */
export function containerYard(o: YardOpts): Box[] {
  let s = (o.seed ?? 7) >>> 0 || 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const maxTier = o.maxTier ?? 3; const slot = C40.len + GAP_X; const out: Box[] = [];
  const nx = Math.floor((o.x1 - o.x0 + GAP_X) / slot); if (nx <= 0) return out;
  const xStart = o.x0 + (o.x1 - o.x0 - (nx * slot - GAP_X)) / 2 + C40.len / 2; // centre the grid in the area
  const rows: number[] = []; let z = o.z0 + C40.w / 2; let inPair = 0;
  while (z + C40.w / 2 <= o.z1 + 1e-9) { rows.push(z); inPair++; z += C40.w + (inPair % 2 ? GAP_Z : LANE); }
  rows.forEach((rz, ri) => { for (let i = 0; i < nx; i++) {
    const cx = xStart + i * slot; const tiers = 1 + Math.floor(rnd() * maxTier); const twenty = rnd() < 0.3; // a whole stack is 20ft pairs or 40ft
    for (let t = 0; t < tiers; t++) { const y = o.deckY + C40.h * (t + 0.5);
      const col = () => CONTAINER_COLORS[Math.floor(rnd() * CONTAINER_COLORS.length)]!;
      if (twenty) for (const d of [-1, 1]) out.push({ x: cx + d * (C20.len / 2 + (C40.len - 2 * C20.len) / 2), y, z: rz, size: 20, color: col(), logo: rnd() < 0.15 });
      else out.push({ x: cx, y, z: rz, size: 40, color: col(), logo: rnd() < 0.2 }); }
  } void ri; });
  return out;
}
export const boxLen = (b: Pick<Box, 'size'>) => (b.size === 40 ? C40.len : C20.len);
