/**
 * Countryside crop fields as buyable farms (pt1250u, Dayne: "these should be farms you can buy also").
 * Every decorative crop field from the outskirts fill (shared/outskirts.ts) is a farm plot `cf:<n>` on the same farm system as
 * the Farm district (deed, plant, grow, harvest, tax, 70% sell-back), priced by tile count with farmPrice (TILE = 2 units).
 */
import { outskirts } from './outskirts.js';
import { TILE, type FarmPlot } from './farm.js';

export const fieldPlotId = (n: number) => `cf:${n}`;
let cache: FarmPlot[] | null = null;
export function fieldPlots(): FarmPlot[] {
  return cache ??= outskirts().fields.map((f, n) => ({ n, x: f.x, z: f.z, w: f.w, d: f.d, rot: 0, cols: Math.max(1, Math.floor(f.w / TILE)), rows: Math.max(1, Math.floor(f.d / TILE)) }));
}
export const fieldPlotOf = (id: unknown) => (typeof id === 'string' && /^cf:\d+$/.test(id) ? fieldPlots()[Number(id.slice(3))] : undefined);
