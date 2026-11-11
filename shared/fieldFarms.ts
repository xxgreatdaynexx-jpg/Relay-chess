/**
 * Countryside crop fields as buyable farms (pt1250u, Dayne: "these should be farms you can buy also").
 * Every decorative crop field from the outskirts fill (shared/outskirts.ts) is a farm plot `cf:<n>` on the same farm system as
 * the Farm district (deed, plant, grow, harvest, tax, 70% sell-back), priced by tile count with farmPrice (TILE = 2 units).
 * The Big Farms east of the ring road (shared/bigFarms.ts) are cf:<1000+k> on the same system, priced with bigFarmPrice.
 */
import { outskirts } from './outskirts.js';
import { TILE, farmPrice, type FarmPlot } from './farm.js';
import { bigFarms, bigFarmPrice, isBigFarmN } from './bigFarms.js';
import { EXP_FARM_N0, expansionFarmPrice, expansionFarms } from './mapExpansion.js';

export const fieldPlotId = (n: number) => `cf:${n}`;
let cache: FarmPlot[] | null = null;
export function fieldPlots(): FarmPlot[] {
  return cache ??= outskirts().fields.map((f) => ({ n: f.n, x: f.x, z: f.z, w: f.w, d: f.d, rot: 0, cols: Math.max(1, Math.floor(f.w / TILE)), rows: Math.max(1, Math.floor(f.d / TILE)) }));
}
let bigCache: FarmPlot[] | null = null;
/** The Big Farms (cf:1000+) as farm plots: same farm system, listed after the outskirts fields. */
export function bigFarmPlots(): FarmPlot[] {
  return bigCache ??= bigFarms().map((b) => ({ n: b.n, x: b.x, z: b.z, w: b.w, d: b.d, rot: 0, cols: b.cols, rows: b.rows }));
}
let expCache: FarmPlot[] | null = null;
export function expansionFarmPlots(): FarmPlot[] {
  return expCache ??= expansionFarms().map((f) => ({ n: f.n, x: f.x, z: f.z, w: f.w, d: f.d, rot: 0, cols: f.cols, rows: f.rows }));
}
/** Every cf:<n> plot: outskirts fields + Big Farms + East Estates expansion farms. */
export const allFieldPlots = (): FarmPlot[] => [...fieldPlots(), ...bigFarmPlots(), ...expansionFarmPlots()];
export const isExpansionFarmN = (n: number) => n >= EXP_FARM_N0;
export const fieldPlotOf = (id: unknown) => {
  if (typeof id !== 'string' || !/^cf:\d+$/.test(id)) return undefined;
  const n = Number(id.slice(3));
  const list = isExpansionFarmN(n) ? expansionFarmPlots() : n >= 1000 ? bigFarmPlots() : fieldPlots();
  return list.find((p) => p.n === n);
};
/** List price (base chips) of a countryside / big farm / expansion farm plot. */
export const fieldPlotPrice = (p: Pick<FarmPlot, 'n' | 'cols' | 'rows'>) => (
  isExpansionFarmN(p.n) ? expansionFarmPrice(p) : isBigFarmN(p.n) ? bigFarmPrice(p.cols * p.rows) : farmPrice(p.cols * p.rows)
);
export const fieldPlotLabel = (p: Pick<FarmPlot, 'n' | 'cols' | 'rows'>) => (
  isExpansionFarmN(p.n) ? `East Estates farm #${p.n - EXP_FARM_N0 + 1} (${p.cols}×${p.rows})`
  : isBigFarmN(p.n) ? `Big Farm #${p.n - 999} (${p.cols}×${p.rows})`
  : `Countryside field #${p.n + 1} (${p.cols}×${p.rows})`
);
