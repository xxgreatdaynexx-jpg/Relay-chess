/**
 * East Orchard Ridge: a buyable fruit-tree district in the Billionaire expansion.
 * Trees are planted once, take several real days to mature, then fruit on a
 * repeating cycle with no replanting. Layout is in the spirit of an Okanagan /
 * Washington apple orchard — tree rows, irrigation, a packing shed on each plot.
 */
import type { FarmPlot } from './farm.js';
import { TILE } from './farm.js';

export const ORCHARD_N0 = 1;
export interface OrchardPlot extends FarmPlot { label: string; price: number }

/** Plot list: keep these off existing East Estates lots, farms, wineries and roads. */
export const orchardPlots = (): OrchardPlot[] => {
  const specs: Array<[number, number, number, number, string]> = [
    // cols, rows, x, z, label
    [8, 6, 600, -360, 'Orchard Ridge 1'],
    [8, 6, 650, -360, 'Orchard Ridge 2'],
    [8, 6, 700, -360, 'Orchard Ridge 3'],
    [10, 8, 600, -405, 'Orchard Ridge North'],
    [10, 8, 660, -405, 'Orchard Ridge East'],
    [8, 6, 710, -405, 'Orchard Ridge Gate'],
    [8, 6, 600, -320, 'Orchard Ridge South'],
    [10, 8, 700, -320, 'Orchard Ridge Bend'],
  ];
  return specs.map(([cols, rows, x, z, label], i) => {
    const w = cols * TILE + 8, d = rows * TILE + 6;
    return { n: ORCHARD_N0 + i, cols, rows, x, z, w, d, rot: 0, label, price: orchardPrice({ cols, rows }) };
  });
};
/** Premium long-hold land: more than a comparable vegetable field, less than a winery. */
export const orchardPrice = (p: Pick<OrchardPlot, 'cols' | 'rows'>) =>
  Math.max(80_000, Math.round((2_400 * p.cols * p.rows) / 5_000) * 5_000);

export const orchardId = (n: number) => `orchard:${n}`;
export const orchardOf = (id: unknown) => (typeof id === 'string' && id.startsWith('orchard:') ? orchardPlots().find((p) => p.n === Number(id.slice(8))) : undefined);

/** Extra roads into the orchard block from the East Estates spine at x = 550. */
export const ORCHARD_ROADS: Array<[[number, number], [number, number]]> = [
  // Sit in the gaps between the three plot rows, off the x=550 spine.
  [[550, -340], [720, -340]],
  [[550, -383], [720, -383]],
];
