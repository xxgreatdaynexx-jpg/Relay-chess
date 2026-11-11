/**
 * East Orchard Ridge: a buyable fruit-tree district in the Billionaire expansion.
 * Trees are planted once, take several real days to mature, then fruit on a
 * repeating cycle with no replanting. Layout is in the spirit of an Okanagan /
 * Washington apple orchard — tree rows, irrigation, a packing shed on each plot.
 */
import type { FarmPlot } from './farm.js';
import { TILE } from './farm.js';
import { expRoadSegments, frontage } from './expansionRoads.js';

export const ORCHARD_N0 = 1;
export interface OrchardPlot extends FarmPlot { label: string; price: number }

/** Plot list: keep these off existing East Estates lots, farms, wineries and roads. */
export const orchardPlots = (): OrchardPlot[] => {
  const specs: Array<[number, number, number, 1 | -1, string]> = [
    // cols, rows, arc s along Orchard Loop, side (+1 inside the loop), label
    [8, 6, 30, -1, 'Orchard Ridge 1'],
    [8, 6, 75, -1, 'Orchard Ridge 2'],
    [8, 6, 125, -1, 'Orchard Ridge 3'],
    [10, 8, 172, -1, 'Orchard Ridge North'],
    [10, 8, 60, 1, 'Orchard Ridge East'],
    [8, 6, 125, 1, 'Orchard Ridge Gate'],
    [8, 6, 185, 1, 'Orchard Ridge South'],
    [10, 8, 240, 1, 'Orchard Ridge Bend'],
  ];
  return specs.map(([cols, rows, at, side, label], i) => {
    const w = cols * TILE + 8, d = rows * TILE + 6; const { x, z } = frontage('or-loop', at, side, w, d, 3, false);
    return { n: ORCHARD_N0 + i, cols, rows, x, z, w, d, rot: 0, label, price: orchardPrice({ cols, rows }) };
  });
};
/** Premium long-hold land: more than a comparable vegetable field, less than a winery. */
export const orchardPrice = (p: Pick<OrchardPlot, 'cols' | 'rows'>) =>
  Math.max(80_000, Math.round((2_400 * p.cols * p.rows) / 5_000) * 5_000);

export const orchardId = (n: number) => `orchard:${n}`;
export const orchardOf = (id: unknown) => (typeof id === 'string' && id.startsWith('orchard:') ? orchardPlots().find((p) => p.n === Number(id.slice(8))) : undefined);

/** Orchard Loop (shared/expansionRoads.ts) as straight pieces, for callers that want simple segments. */
export const ORCHARD_ROADS: Array<[[number, number], [number, number]]> = expRoadSegments().filter((g) => g.id === 'or-loop').map((g) => [g.a, g.b]);
