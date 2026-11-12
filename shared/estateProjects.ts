/**
 * Private construction sites (Billionaire Update). Buyable open land, or a lot freed by demolishing
 * your own non-monument building, can be built in stages like the co-op hockey stadium. The owner
 * picks one project: data center, bitcoin farm, personal monument, mansion, highrise, or power plant.
 * Data centers and bitcoin farms then run on bought hardware and power (grid contract or a plant).
 */
import { GOODS, type ItemType } from './mines.js';

export type EstateBuildId = 'data_center' | 'bitcoin_farm' | 'monument' | 'mansion' | 'highrise' | 'power_plant';
export type EstateSiteKind = 'open' | 'demolished' | 'winery' | 'turnkey_plant';
export type EstateStageId = string;

export interface EstateStagePlan {
  id: EstateStageId;
  name: string;
  chips: number;
  goods: Array<[string, number]>;
}

export interface EstateBuildPlan {
  id: EstateBuildId;
  name: string;
  icon: string;
  blurb: string;
  /** Total chips-equivalent at house prices (chips + goods). */
  total: number;
  stages: EstateStagePlan[];
  /** Footprint used by the finished model (world units). */
  w: number;
  d: number;
  h: number;
}

const g = (id: string, qty: number): [string, number] => [id, qty];

export const ESTATE_BUILDS: Record<EstateBuildId, EstateBuildPlan> = {
  data_center: {
    id: 'data_center', name: 'Data Center', icon: '🖥️',
    blurb: 'A cooled hall of server racks. Buy computers after the build; it draws power and earns from compute contracts.',
    total: 1_607_560, w: 28, d: 22, h: 14,
    stages: [
      { id: 'pad', name: 'Site & slab', chips: 280_000, goods: [g('concrete', 2_400), g('brick', 1_200)] },
      { id: 'shell', name: 'Halls & risers', chips: 320_000, goods: [g('steel_beam', 900), g('steel_plate', 700)] },
      { id: 'plant', name: 'Cooling plant', chips: 360_000, goods: [g('pump', 80), g('valve', 160), g('steel_cable', 400)] },
      { id: 'fit', name: 'Fit-out', chips: 300_000, goods: [g('glass', 800), g('copper_foil', 400), g('sensor', 120)] },
    ],
  },
  bitcoin_farm: {
    id: 'bitcoin_farm', name: 'Bitcoin Farm', icon: '₿',
    blurb: 'A loud hall of graphics cards. Buy GPUs after the build; hashrate needs steady power.',
    total: 1_317_280, w: 24, d: 20, h: 10,
    stages: [
      { id: 'pad', name: 'Site & slab', chips: 240_000, goods: [g('concrete', 2_000), g('brick', 900)] },
      { id: 'shell', name: 'Shed & busways', chips: 280_000, goods: [g('steel_beam', 700), g('steel_cable', 500)] },
      { id: 'cool', name: 'Air handlers', chips: 300_000, goods: [g('pump', 60), g('valve', 120), g('sensor', 80)] },
      { id: 'fit', name: 'Benches & feed', chips: 260_000, goods: [g('copper_foil', 500), g('glass', 400), g('battery', 80)] },
    ],
  },
  monument: {
    id: 'monument', name: 'Personal Chud Monument', icon: '🗽',
    blurb: 'A giant statue of you on a tiled plaza, lit at night. Pure prestige — no income.',
    total: 729_640, w: 18, d: 18, h: 28,
    stages: [
      { id: 'pad', name: 'Plaza', chips: 160_000, goods: [g('concrete', 1_200), g('brick', 800)] },
      { id: 'plinth', name: 'Plinth', chips: 180_000, goods: [g('floor_tile', 800), g('concrete', 600)] },
      { id: 'figure', name: 'Figure', chips: 200_000, goods: [g('bronze', 400), g('steel', 200)] },
      { id: 'light', name: 'Lighting', chips: 140_000, goods: [g('glass', 300), g('gold_wire', 80), g('lantern', 40)] },
    ],
  },
  mansion: {
    id: 'mansion', name: 'Personal Mansion', icon: '🏡',
    blurb: 'A private mansion with a long drive and gardens. Enterable like other homes.',
    total: 1_919_240, w: 32, d: 24, h: 16,
    stages: [
      { id: 'pad', name: 'Foundations', chips: 400_000, goods: [g('concrete', 2_800), g('brick', 1_600)] },
      { id: 'shell', name: 'Walls & floors', chips: 480_000, goods: [g('steel_beam', 600), g('floor_tile', 1_200)] },
      { id: 'roof', name: 'Roof & glass', chips: 440_000, goods: [g('crystal_glass', 400), g('steel_plate', 400)] },
      { id: 'fit', name: 'Interiors', chips: 400_000, goods: [g('chandelier', 20), g('mirror', 40), g('gold_wire', 60)] },
    ],
  },
  highrise: {
    id: 'highrise', name: 'Personal Highrise', icon: '🏙️',
    blurb: 'A slim private tower with a lit crown. Enterable, and it adds housing for employees.',
    total: 3_258_340, w: 22, d: 22, h: 48,
    stages: [
      { id: 'pad', name: 'Foundations', chips: 600_000, goods: [g('concrete', 4_000), g('steel_beam', 800)] },
      { id: 'core', name: 'Core & floors', chips: 720_000, goods: [g('steel_beam', 1_400), g('steel_plate', 1_000)] },
      { id: 'skin', name: 'Curtain wall', chips: 680_000, goods: [g('crystal_glass', 900), g('stainless', 400)] },
      { id: 'crown', name: 'Crown & lifts', chips: 600_000, goods: [g('gold_wire', 120), g('sensor', 80), g('girder', 200)] },
    ],
  },
  power_plant: {
    id: 'power_plant', name: 'Power Plant', icon: '⚡',
    blurb: 'A privately owned plant. It supplies your data centers and bitcoin farms, or you can sell surplus to the grid.',
    total: 2_462_496, w: 36, d: 26, h: 22,
    stages: [
      { id: 'pad', name: 'Site & halls', chips: 480_000, goods: [g('concrete', 3_200), g('brick', 1_000)] },
      { id: 'boiler', name: 'Boiler island', chips: 560_000, goods: [g('steel_plate', 900), g('valve', 200), g('pump', 80)] },
      { id: 'turbine', name: 'Turbine hall', chips: 600_000, goods: [g('turbine', 8), g('steel_cable', 600), g('girder', 300)] },
      { id: 'yard', name: 'Switchyard', chips: 440_000, goods: [g('copper_foil', 600), g('sensor', 100), g('battery', 40)] },
    ],
  },
};


export const ESTATE_BUILD_ORDER: EstateBuildId[] = ['data_center', 'bitcoin_farm', 'monument', 'mansion', 'highrise', 'power_plant'];

export interface StageNeed {
  id: string;
  name: string;
  chips: number;
  goods: Array<{ type: ItemType; id: string; name: string; qty: number; price: number }>;
}

export function estateStages(p: EstateBuildPlan): StageNeed[] {
  return p.stages.map((s) => ({
    id: s.id, name: s.name, chips: s.chips,
    goods: s.goods.map(([id, qty]) => {
      const item = GOODS[id];
      if (!item) throw new Error(`estate: unknown good ${id} in ${p.id}/${s.id}`);
      return { type: item.type, id, name: item.name, price: item.price, qty };
    }),
  }));
}

export const partKey = (g: { type: ItemType; id: string } | 'chips') => (g === 'chips' ? 'chips' : `${g.type}:${g.id}`);
export const stageValue = (s: StageNeed) => s.chips + s.goods.reduce((a, x) => a + x.qty * x.price, 0);
export const estateProjectValue = (p: EstateBuildPlan) => estateStages(p).reduce((a, s) => a + stageValue(s), 0);
export const stagePct = (s: StageNeed, done: Record<string, number>) => {
  const need = stageValue(s);
  const got = Math.min(s.chips, done.chips ?? 0) + s.goods.reduce((a, x) => a + Math.min(x.qty, done[partKey(x)] ?? 0) * x.price, 0);
  return need <= 0 ? 1 : Math.max(0, Math.min(1, got / need));
};
export const stageFull = (s: StageNeed, done: Record<string, number>) =>
  (done.chips ?? 0) >= s.chips && s.goods.every((x) => (done[partKey(x)] ?? 0) >= x.qty);
export const buildStageIndex = (stages: StageNeed[], doneByStage: Array<Record<string, number> | undefined>) => {
  let i = 0;
  while (i < stages.length && stageFull(stages[i]!, doneByStage[i] ?? {})) i++;
  return i;
};

/** Finished buildings that are enterable homes. */
export const ESTATE_HOME_BUILDS = new Set<EstateBuildId>(['mansion', 'highrise']);

/** Employee housing slots once a highrise is complete. */
export const HIGHRISE_EMPLOYEES = 4;

// ---- Hardware & power (data center / bitcoin farm / plants) ----
export interface GearDef {
  id: string;
  name: string;
  icon: string;
  /** Base chip cost (indexed at purchase). */
  price: number;
  /** MW drawn while the machine is running. */
  mw: number;
  /** Chips earned per hour at full power (before the daily cap). */
  chipsPerHour: number;
  max: number;
  /** Optional factory goods consumed to install one unit (in addition to chips). */
  install?: Array<[string, number]>;
}

export const SERVER_RACK: GearDef = {
  id: 'server_rack_unit', name: 'Server rack', icon: '🖥️', price: 120_000, mw: 3, chipsPerHour: 1_105, max: 8,
  install: [['server_rack', 1], ['plastic_resin', 4]],
};
export const GPU_RIG: GearDef = {
  id: 'gpu_rig', name: 'GPU rig', icon: '🎮', price: 45_000, mw: 1.5, chipsPerHour: 454, max: 16,
  install: [['gpu', 1], ['plastic_resin', 2]],
};

export const GEAR_FOR: Record<'data_center' | 'bitcoin_farm', GearDef> = {
  data_center: SERVER_RACK,
  bitcoin_farm: GPU_RIG,
};

/** A completed power plant's nameplate output (MW). */
export const PLANT_MW = 40;
/** Daily fuel contract (base chips) to run a plant at full load, or coal from the warehouse. */
export const PLANT_FUEL_DAY = 8_000;
export const PLANT_COAL_PER_HOUR = 80;
/** Chips per MW per day for a utility ("pre-existing stock") power contract. */
export const GRID_POWER_DAY = 1_200;
/** Combined daily cap (base chips, then indexed) on data-center + bitcoin income.
 *  400,000 covers one full bitcoin farm + one full data center (174,336 + 212,160 = 386,496) without clipping. */
export const DIGITAL_DAILY_BASE = 400_000;
/** Power plants can sell unused MW back to the grid at this fraction of the utility rate. */
export const GRID_SELL_FRACTION = 0.45;

export function throttle(supplyMw: number, demandMw: number): number {
  if (demandMw <= 0) return 1;
  if (supplyMw <= 0) return 0;
  return Math.max(0, Math.min(1, supplyMw / demandMw));
}

export function digitalPayout(gross: number, already: number, cap: number): number {
  const room = Math.max(0, cap - already);
  return Math.floor(Math.max(0, Math.min(gross, room)) + 1e-9);
}

// ---- Demolish ----
/** Property types that may be demolished by their owner to free a construction site. */
export const DEMOLISHABLE_TYPES = new Set([
  'house', 'rowhouse', 'apartment', 'tower', 'farm', 'farmland', 'barn',
  'gas', 'depot', 'beachhouse', 'condo', 'villa', 'hotel', 'plantation',
  'estate_lot', 'mansion', 'highrise', 'data_center', 'bitcoin_farm', 'monument', 'power_plant',
  'winery',
]);

/** Never demolish these (civic, public services, monuments, special maps). */
export const DEMOLISH_BLOCKED_TYPES = new Set([
  'cityhall', 'club', 'skytower', 'harbour', 'jail', 'airport', 'racetrack',
  'casino', 'chess', 'mine', 'mine-frost', 'mine-magma', 'mine-quarry', 'arena',
  'factory', 'warehouse', 'bank', 'market', 'leaderboard', 'chat', 'stocks',
  'dealer', 'grocery', 'mechanic', 'employ', 'furniture', 'plaza', 'park',
  'penthouse', 'isleestate', 'plastics', 'rigdock',
]);

export const DEMOLISH_RULES = [
  'You can only demolish a building or farm you own.',
  'Landmarks, civic buildings, the stadium, the harbour, the jail, sky penthouses and island estates cannot be demolished.',
  'Furniture in a demolished home returns to your furniture locker.',
  'Stored kitchen, pantry and warehouse items stay in those inventories. They are not deleted.',
  'Crops still growing are returned as seeds. Ripe crops go to your warehouse.',
  'There is no chip refund for the structure. Sell the deed first if you want the usual 70% sell-back.',
  'The lot stays yours and becomes a private construction site.',
].join(' ');

export function canDemolish(p: { id: string; kind: string; type: string; map?: string } | null | undefined): { ok: boolean; reason?: string } {
  if (!p) return { ok: false, reason: 'That property is not on the map.' };
  if (p.map === 'resort' || p.map === 'island') return { ok: false, reason: 'Resort and island properties cannot be demolished.' };
  if (p.id.startsWith('sky:') || p.id.startsWith('isl:') || p.id.startsWith('lm:')) {
    return { ok: false, reason: 'Landmarks and civic buildings cannot be demolished.' };
  }
  if (DEMOLISH_BLOCKED_TYPES.has(p.type)) return { ok: false, reason: 'That structure cannot be demolished.' };
  if (p.kind === 'landmark') return { ok: false, reason: 'Landmarks cannot be demolished.' };
  if (!DEMOLISHABLE_TYPES.has(p.type) && p.kind !== 'farm' && p.kind !== 'building' && p.kind !== 'patch') {
    return { ok: false, reason: 'That structure cannot be demolished.' };
  }
  if (p.kind === 'farm' || DEMOLISHABLE_TYPES.has(p.type)) return { ok: true };
  return { ok: false, reason: 'That structure cannot be demolished.' };
}

export type EstateSiteState = {
  id: string;
  lotId: string;
  owner: string;
  kind: EstateSiteKind;
  build: EstateBuildId | null;
  /** Completed stages (0..4). */
  stage: number;
  /** Contributions toward the current (or each) stage. */
  done: Array<Record<string, number>>;
  /** Installed hardware counts (racks / GPUs). */
  gear: number;
  /** Last settlement timestamp. */
  settledAt: number;
  launched?: boolean;
  /** For a demolished lot, the previous property type/label (for the deed card). */
  was?: { type: string; label: string };
};

export const emptySiteDone = (plan: EstateBuildPlan): Array<Record<string, number>> => plan.stages.map(() => ({}));
