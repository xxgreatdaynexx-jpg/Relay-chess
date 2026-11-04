/**
 * The open ocean south of Chud Hub (mu-visuals, Dayne: "need to make an actual ocean"). Everything here lies OUTSIDE the
 * old map bounds (MAP_BOUNDS.z1 / OUTSKIRTS.z1): no existing lot, field, house or landmark moves. The beach starts at the
 * outskirts' south edge, the shoreline follows, and Chud Hub Harbour sits on the coast behind a breakwater.
 */
import { OUTSKIRTS } from './worldLayout.js';

export const OCEAN = { x0: -900, x1: 900, beachZ: OUTSKIRTS.z1, shoreZ: OUTSKIRTS.z1 + 14, z1: 1100 } as const;
/** Gentle wavy coastline (still always south of beachZ + 8). */
export const COAST_WAVE = [2.2, 31, 1.3, 13] as const;
export const coastZ = (x: number) => OCEAN.shoreZ + COAST_WAVE[0] * Math.sin(x / COAST_WAVE[1] + 0.7) + COAST_WAVE[2] * Math.sin(x / COAST_WAVE[3] + 2.1);
/** Harbour: quay along the shore, a pier out to sea, and a breakwater arm sheltering the basin. */
export const HARBOUR = { x: 40, quayZ: OCEAN.shoreZ + 2, pierZ1: OCEAN.shoreZ + 34, basinW: 70 } as const;
export const BREAKWATER: Array<[number, number]> = [[HARBOUR.x - 40, OCEAN.shoreZ + 1], [HARBOUR.x - 44, OCEAN.shoreZ + 22], [HARBOUR.x - 34, OCEAN.shoreZ + 42], [HARBOUR.x - 12, OCEAN.shoreZ + 50], [HARBOUR.x + 6, OCEAN.shoreZ + 50]];
/** How far south the camera may pan (farm.ts MAP_VIEW): the harbour and a strip of open water. */
export const VIEW_Z1 = HARBOUR.pierZ1 + 26;
