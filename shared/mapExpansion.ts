/**
 * Billionaire Update map expansion: new land east of the Big Farms and a small rich
 * community (Goldwood) north of the city. Existing plate, farms, deeds and coordinates
 * are not moved. Camera / drive bounds pick this up through MAP_BOUNDS.
 */
import type { OBB } from './worldLayout.js';
import { GOLDWOOD_C, ellipsePoint, expRoadSegments, frontage } from './expansionRoads.js';

export const EAST_X0 = 380;
export const EAST_X1 = 720;
export const EAST_Z0 = -420;
export const EAST_Z1 = 160;
export const GOLDWOOD = { x0: -80, x1: 250, z0: -452, z1: -270 };
export const EXPANSION_BOUNDS = {
  x0: Math.min(EAST_X0, GOLDWOOD.x0),
  x1: Math.max(EAST_X1, GOLDWOOD.x1),
  z0: Math.min(EAST_Z0, GOLDWOOD.z0),
  z1: Math.max(EAST_Z1, GOLDWOOD.z1),
};

export const EXPANSION_ROAD_W = 5;
type P = [number, number];
/**
 * Expansion roads as coarse straight pieces (car bounds, old callers). The real network is the curved one in
 * shared/expansionRoads.ts: Goldwood Circle + Goldwood Drive, the Airport Expressway, Estates Parkway, Ridge Road,
 * the Coastal Highway, Estates Crescent and the lanes off them, all tied into the Big Farms / rural roads.
 */
export const EXPANSION_ROADS: Array<[P, P]> = expRoadSegments().map((g) => [g.a, g.b]);

export interface EstateLot extends OBB {
  n: number;
  label: string;
  /** Base list price. */
  price: number;
  kind: 'open' | 'turnkey_plant';
  h: number;
}

/** Buyable vacant lots in the East Estates, set along street frontage and turned to face their street. */
export const estateLots = (): EstateLot[] => {
  const lots: EstateLot[] = [];
  const cells: Array<[number, string, number, 1 | -1, number, number, 'open' | 'turnkey_plant', string]> = [
    // n, road, arc s, side, w (along street), d (deep), kind, label
    [1, 'ee-bay', 40, 1, 32, 26, 'open', 'East Estates Lot 1'],
    [2, 'ee-bay', 80, 1, 32, 26, 'open', 'East Estates Lot 2'],
    [3, 'ee-bay', 120, 1, 32, 26, 'open', 'East Estates Lot 3'],
    [4, 'ee-bay', 200, 1, 36, 28, 'open', 'East Estates Lot 4'],
    [5, 'ee-bay', 240, 1, 36, 28, 'open', 'East Estates Lot 5'],
    [6, 'ee-bay', 276, 1, 36, 28, 'open', 'East Estates Lot 6'],
    [7, 'ee-bay', 380, 1, 34, 28, 'open', 'East Estates Lot 7'],
    [8, 'ee-bay', 418, 1, 34, 28, 'open', 'East Estates Lot 8'],
    [9, 'ee-bay', 70, -1, 34, 28, 'open', 'East Estates Lot 9'],
    [10, 'ee-bay', 175, -1, 34, 28, 'open', 'East Estates Lot 10'],
    [11, 'ee-bay', 245, -1, 34, 28, 'open', 'East Estates Lot 11'],
    [12, 'ee-bay', 330, -1, 34, 28, 'open', 'East Estates Lot 12'],
    [13, 'ee-court', 27, -1, 40, 32, 'open', 'East Estates Lot 13'],
    [14, 'ee-court', 71, -1, 40, 32, 'open', 'East Estates Lot 14'],
    [15, 'ee-court', 29, 1, 36, 28, 'open', 'East Estates Lot 15'],
    [16, 'ee-court', 76, 1, 36, 28, 'open', 'East Estates Lot 16'],
    [17, 'ee-north', 268, 1, 40, 32, 'turnkey_plant', 'Turnkey Power Plant A'],
    [18, 'ee-north', 334, 1, 40, 32, 'turnkey_plant', 'Turnkey Power Plant B'],
  ];
  for (const [n, road, at, side, w, d, kind, label] of cells) {
    const { x, z, rot } = frontage(road, at, side, w, d, kind === 'turnkey_plant' ? 4 : side < 0 && road === 'ee-bay' ? 4.5 : 2.5);
    const price = kind === 'turnkey_plant' ? 5_500_000 : Math.round((12_000 * w * d) / 5000) * 5000;
    lots.push({ n, x, z, w, d, rot, kind, label, price, h: kind === 'turnkey_plant' ? 22 : 0 });
  }
  return lots;
};
export const estateLotId = (n: number) => `lot:estate:${n}`;
export const estateLotOf = (id: unknown) => (typeof id === 'string' && id.startsWith('lot:estate:') ? estateLots().find((l) => l.n === Number(id.slice(11))) : undefined);

export interface GoldwoodHome extends OBB {
  n: number;
  label: string;
  price: number;
  floors: number;
  h: number;
}

/** Driveway reach in front of a Goldwood mansion model (its U drive ends ~20 units in front of the house centre). */
export const GOLDWOOD_SETBACK = 22;
/** Landscaped lot around each mansion (lawn, pool, drive, hedges), centred a little in front of the house. */
export const goldwoodLot = (h: Pick<GoldwoodHome, 'x' | 'z' | 'rot'>): OBB => ({ x: h.x + Math.sin(h.rot) * 2.5, z: h.z + Math.cos(h.rot) * 2.5, w: 40, d: 36, rot: h.rot });
/** Pre-built mansions in the Goldwood community (enterable homes), around Goldwood Circle facing its central green. */
export const goldwoodHomes = (): GoldwoodHome[] => {
  const rows: Array<[number, number, number, number, string, number]> = [
    // n, angle on Goldwood Circle (deg), w, d, label, price
    [1, 214, 18, 14, 'Goldwood Manor North', 1_600_000],
    [2, 245, 20, 16, 'Goldwood Hill House', 1_900_000],
    [3, 277, 22, 16, 'Goldwood Crest', 2_400_000],
    [4, 309, 18, 14, 'Goldwood East Lodge', 1_400_000],
    [5, 145, 22, 16, 'Goldwood West Villa', 2_200_000],
    [6, 110, 24, 18, 'Goldwood Hall', 3_000_000],
    [7, 72, 20, 16, 'Goldwood Court', 2_100_000],
    [8, 341, 18, 14, 'Goldwood Gate House', 1_250_000],
  ];
  return rows.map(([n, deg, w, d, label, price]) => {
    const t = (deg * Math.PI) / 180; const [rx, rz] = ellipsePoint(t);
    // outward normal of the ellipse at t, then set the house back so its drive meets the curb
    const nx = Math.cos(t) / GOLDWOOD_C.rx, nz = Math.sin(t) / GOLDWOOD_C.rz, L = Math.hypot(nx, nz);
    const off = 2.25 + GOLDWOOD_SETBACK; const x = Math.round((rx + (nx / L) * off) * 10) / 10, z = Math.round((rz + (nz / L) * off) * 10) / 10;
    const rot = Math.round(Math.atan2(rx - x, rz - z) * 1000) / 1000;
    return { n, x, z, w, d, rot, h: 10, floors: 2, label, price };
  });
};
export const goldwoodId = (n: number) => `b:mansion:${n}`;
export const goldwoodOf = (id: unknown) => (typeof id === 'string' && id.startsWith('b:mansion:') ? goldwoodHomes().find((h) => goldwoodId(h.n) === id) : undefined);

/** Extra farmland in the East Estates. n starts at 2000 so it never collides with existing cf: / big-farm ids. */
export const EXP_FARM_N0 = 2000;
export interface ExpansionFarm extends OBB { n: number; cols: number; rows: number }
export const expansionFarms = (): ExpansionFarm[] => {
  const specs: Array<[number, number, string, number, 1 | -1]> = [
    // cols, rows, road, arc s, side (fields sit square to the compass, set back from their road)
    [16, 12, 'ee-farm-w', 172, -1],
    [16, 12, 'ee-farm-w', 205, -1],
    [20, 16, 'ee-farm-w', 52, -1],
    [20, 16, 'ee-north', 192, -1],
    [14, 10, 'ee-coast', 112, -1],
    [14, 10, 'ee-coast', 148, -1],
    [24, 18, 'ee-parkway', 278, 1],
    [24, 18, 'ee-parkway', 322, 1],
    [12, 10, 'ee-north', 118, -1],
    [12, 10, 'ee-north', 152, -1],
  ];
  return specs.map(([cols, rows, road, at, side], i) => {
    const w = cols * 2 + 2, d = rows * 2 + 2; const { x, z } = frontage(road, at, side, w, d, 3, false);
    return { n: EXP_FARM_N0 + i, cols, rows, x, z, w, d, rot: 0 };
  });
};
export const expansionFarmPrice = (p: Pick<ExpansionFarm, 'cols' | 'rows'>) => {
  const tiles = p.cols * p.rows;
  const base = Math.max(500, Math.round((180 * tiles + 500) / 500) * 500);
  return Math.max(base * 2, 25_000);
};

export interface WineryPlot extends ExpansionFarm { label: string; price: number }
/** Vineyards with an on-site press — grapes grow faster and press to wine more efficiently. */
export const WINE_N0 = 1;
export const wineryPlots = (): WineryPlot[] => {
  const specs: Array<[number, number, string, number, 1 | -1, string, number]> = [
    // cols, rows, road, arc s, side, label, price
    [10, 8, 'gw-vine', 84, -1, 'Goldwood Vineyard North', 280_000],
    [10, 8, 'gw-vine', 117, 1, 'Goldwood Vineyard East', 280_000],
    [12, 10, 'gw-vine', 32, 1, 'Goldwood Estate Winery', 420_000],
    [8, 8, 'ee-coast', 256, -1, 'East Estates Vineyard', 220_000],
    [10, 8, 'ee-coast', 304, -1, 'East Estates Press', 260_000],
  ];
  return specs.map(([cols, rows, road, at, side, label, price], i) => {
    // place the whole estate model (hall, terrace, vine rows: WINERY_VISUAL) on the frontage, facing the road
    const v = frontage(road, at, side, WINERY_VISUAL.w, WINERY_VISUAL.d, 2.5);
    const x = Math.round((v.x - Math.sin(v.rot) * WINERY_VISUAL.dz) * 10) / 10, z = Math.round((v.z - Math.cos(v.rot) * WINERY_VISUAL.dz) * 10) / 10;
    return { n: WINE_N0 + i, cols, rows, x, z, w: cols * 2 + 4, d: rows * 2 + 4, rot: v.rot, label, price };
  });
};
/** The winery model's grounds (lawn 36×32, centred 4 in front of the hall). */
export const WINERY_VISUAL = { w: 36, d: 32, dz: 4 };
export const wineryVisual = (v: Pick<WineryPlot, 'x' | 'z' | 'rot'>): OBB => ({ x: v.x + Math.sin(v.rot) * WINERY_VISUAL.dz, z: v.z + Math.cos(v.rot) * WINERY_VISUAL.dz, w: WINERY_VISUAL.w, d: WINERY_VISUAL.d, rot: v.rot });
export const wineryId = (n: number) => `winery:${n}`;
export const wineryOf = (id: unknown) => (typeof id === 'string' && id.startsWith('winery:') ? wineryPlots().find((p) => p.n === Number(id.slice(7))) : undefined);

/** Grapes on a winery plot grow in this fraction of the usual time and yield this many extra harvests. */
export const WINERY_GROW_MUL = 0.55;
export const WINERY_YIELD_BONUS = 0.25;
/** Grapes pressed at a winery: 1 grape → 1 wine (the city cannery needs 2). */
export const WINERY_GRAPES_PER_WINE = 1;

/** Chud City Plastics Plant — industrial annex just east of the plate, south of the farm lanes. */
export const PLASTICS_PLANT = { x: 186, z: 88, w: 22, d: 16, h: 14, rot: 0 } as const;
/** Shoreline construction dock, east of Chud Hub Harbour on the ocean beach. */
export const RIG_DOCK = { x: 130, z: 210, w: 28, d: 18, h: 12, rot: 0 } as const;
/** World positions of launched rigs (further south, out at sea). */
export const RIG_BERTHS: Array<[number, number]> = [
  [110, 300], [140, 320], [170, 300], [125, 350], [160, 360], [95, 340],
];

export const PLASTICS_ID = 'lm:plastics';
export const RIG_DOCK_ID = 'lm:rigdock';

export const inExpansion = (x: number, z: number) =>
  (x >= EAST_X0 - 8 && x <= EAST_X1 + 8 && z >= EAST_Z0 - 8 && z <= EAST_Z1 + 8) ||
  (x >= GOLDWOOD.x0 - 8 && x <= GOLDWOOD.x1 + 8 && z >= GOLDWOOD.z0 - 8 && z <= GOLDWOOD.z1 + 8) ||
  (Math.abs(x - RIG_DOCK.x) < 80 && z >= 190 && z <= 400);

export const expansionGroundBoxes = (): OBB[] => [
  { x: (EAST_X0 + EAST_X1) / 2, z: (EAST_Z0 + EAST_Z1) / 2, w: EAST_X1 - EAST_X0, d: EAST_Z1 - EAST_Z0, rot: 0 },
  { x: (GOLDWOOD.x0 + GOLDWOOD.x1) / 2, z: (GOLDWOOD.z0 + GOLDWOOD.z1) / 2, w: GOLDWOOD.x1 - GOLDWOOD.x0, d: GOLDWOOD.z1 - GOLDWOOD.z0, rot: 0 },
];
