/**
 * Billionaire Update map expansion: new land east of the Big Farms and a small rich
 * community (Goldwood) north of the city. Existing plate, farms, deeds and coordinates
 * are not moved. Camera / drive bounds pick this up through MAP_BOUNDS.
 */
import type { OBB } from './worldLayout.js';

export const EAST_X0 = 380;
export const EAST_X1 = 720;
export const EAST_Z0 = -420;
export const EAST_Z1 = 160;
export const GOLDWOOD = { x0: -60, x1: 200, z0: -450, z1: -330 };
export const EXPANSION_BOUNDS = {
  x0: Math.min(EAST_X0, GOLDWOOD.x0),
  x1: Math.max(EAST_X1, GOLDWOOD.x1),
  z0: Math.min(EAST_Z0, GOLDWOOD.z0),
  z1: Math.max(EAST_Z1, GOLDWOOD.z1),
};

export const EXPANSION_ROAD_W = 5;
type P = [number, number];
/** Spine roads that connect the new land to the Big Farms north/east roads. */
export const EXPANSION_ROADS: Array<[P, P]> = [
  // east connector from the Big Farms east road (~346) onto the new spine
  [[346, -40], [EAST_X0, -40]],
  [[EAST_X0, -40], [550, -40]],
  [[550, -40], [550, EAST_Z0 + 20]],
  [[550, -40], [550, 120]],
  [[550, 120], [680, 120]],
  [[550, -200], [680, -200]],
  [[400, -40], [400, EAST_Z1 - 20]],
  [[400, -40], [400, -300]],
  // north to Goldwood from the Big Farms north road (z = -304)
  [[80, -304], [80, GOLDWOOD.z1]],
  [[80, GOLDWOOD.z1], [80, (GOLDWOOD.z0 + GOLDWOOD.z1) / 2]],
  [[GOLDWOOD.x0 + 10, (GOLDWOOD.z0 + GOLDWOOD.z1) / 2], [GOLDWOOD.x1 - 10, (GOLDWOOD.z0 + GOLDWOOD.z1) / 2]],
  [[80, (GOLDWOOD.z0 + GOLDWOOD.z1) / 2], [80, GOLDWOOD.z0 + 16]],
  [[-20, (GOLDWOOD.z0 + GOLDWOOD.z1) / 2], [-20, GOLDWOOD.z0 + 16]],
  [[140, (GOLDWOOD.z0 + GOLDWOOD.z1) / 2], [140, GOLDWOOD.z0 + 16]],
];

export interface EstateLot extends OBB {
  n: number;
  label: string;
  /** Base list price. */
  price: number;
  kind: 'open' | 'turnkey_plant';
  h: number;
}

/** Buyable vacant lots in the East Estates. */
export const estateLots = (): EstateLot[] => {
  const lots: EstateLot[] = [];
  const cells: Array<[number, number, number, number, number, 'open' | 'turnkey_plant', string]> = [
    // n, x, z, w, d, kind, label
    [1, 430, 20, 32, 26, 'open', 'East Estates Lot 1'],
    [2, 470, 20, 32, 26, 'open', 'East Estates Lot 2'],
    [3, 510, 20, 32, 26, 'open', 'East Estates Lot 3'],
    [4, 430, 70, 36, 28, 'open', 'East Estates Lot 4'],
    [5, 475, 70, 36, 28, 'open', 'East Estates Lot 5'],
    [6, 520, 70, 36, 28, 'open', 'East Estates Lot 6'],
    [7, 620, -80, 34, 28, 'open', 'East Estates Lot 7'],
    [8, 665, -80, 34, 28, 'open', 'East Estates Lot 8'],
    [9, 620, -20, 34, 28, 'open', 'East Estates Lot 9'],
    [10, 665, -20, 34, 28, 'open', 'East Estates Lot 10'],
    [11, 620, 40, 34, 28, 'open', 'East Estates Lot 11'],
    [12, 665, 40, 34, 28, 'open', 'East Estates Lot 12'],
    [13, 430, -140, 40, 32, 'open', 'East Estates Lot 13'],
    [14, 480, -140, 40, 32, 'open', 'East Estates Lot 14'],
    [15, 430, -200, 36, 28, 'open', 'East Estates Lot 15'],
    [16, 480, -200, 36, 28, 'open', 'East Estates Lot 16'],
    [17, 640, -280, 40, 32, 'turnkey_plant', 'Turnkey Power Plant A'],
    [18, 690, -280, 40, 32, 'turnkey_plant', 'Turnkey Power Plant B'],
  ];
  for (const [n, x, z, w, d, kind, label] of cells) {
    const price = kind === 'turnkey_plant' ? 5_500_000 : Math.round((12_000 * w * d) / 5000) * 5000;
    lots.push({ n, x, z, w, d, rot: 0, kind, label, price, h: kind === 'turnkey_plant' ? 22 : 0 });
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

/** Pre-built mansions in the Goldwood community (enterable homes). */
export const goldwoodHomes = (): GoldwoodHome[] => {
  const rows: Array<[number, number, number, number, number, string, number]> = [
    [1, -20, -410, 18, 14, 'Goldwood Manor North', 1_600_000],
    [2, 20, -410, 20, 16, 'Goldwood Hill House', 1_900_000],
    [3, 80, -410, 22, 16, 'Goldwood Crest', 2_400_000],
    [4, 140, -410, 18, 14, 'Goldwood East Lodge', 1_400_000],
    [5, -20, -370, 22, 16, 'Goldwood West Villa', 2_200_000],
    [6, 40, -370, 24, 18, 'Goldwood Hall', 3_000_000],
    [7, 100, -370, 20, 16, 'Goldwood Court', 2_100_000],
    [8, 160, -370, 18, 14, 'Goldwood Gate House', 1_250_000],
  ];
  return rows.map(([n, x, z, w, d, label, price]) => ({ n, x, z, w, d, rot: 0, h: 10, floors: 2, label, price }));
};
export const goldwoodId = (n: number) => `b:mansion:${n}`;
export const goldwoodOf = (id: unknown) => (typeof id === 'string' && id.startsWith('b:mansion:') ? goldwoodHomes().find((h) => goldwoodId(h.n) === id) : undefined);

/** Extra farmland in the East Estates. n starts at 2000 so it never collides with existing cf: / big-farm ids. */
export const EXP_FARM_N0 = 2000;
export interface ExpansionFarm extends OBB { n: number; cols: number; rows: number }
export const expansionFarms = (): ExpansionFarm[] => {
  const specs: Array<[number, number, number, number]> = [
    // cols, rows, x, z
    [16, 12, 430, -80],
    [16, 12, 480, -80],
    [20, 16, 430, -250],
    [20, 16, 480, -250],
    [14, 10, 620, 90],
    [14, 10, 665, 90],
    [24, 18, 620, -160],
    [24, 18, 680, -160],
    [12, 10, 400, -340],
    [12, 10, 450, -340],
  ];
  return specs.map(([cols, rows, x, z], i) => ({
    n: EXP_FARM_N0 + i, cols, rows, x, z, w: cols * 2 + 2, d: rows * 2 + 2, rot: 0,
  }));
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
  const specs: Array<[number, number, number, number, string, number]> = [
    [10, 8, 200, -400, 'Goldwood Vineyard North', 280_000],
    [10, 8, 250, -400, 'Goldwood Vineyard East', 280_000],
    [12, 10, 200, -360, 'Goldwood Estate Winery', 420_000],
    [8, 8, 400, 80, 'East Estates Vineyard', 220_000],
    [10, 8, 700, -50, 'East Estates Press', 260_000],
  ];
  return specs.map(([cols, rows, x, z, label, price], i) => ({
    n: WINE_N0 + i, cols, rows, x, z, w: cols * 2 + 4, d: rows * 2 + 4, rot: 0, label, price,
  }));
};
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
