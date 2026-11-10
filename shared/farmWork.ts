/**
 * Farming rework (Millionaire Update, Farming Simulator style) with the #27 fertilizer rework folded in.
 *
 * Every crop now goes through steps the player actually does, one tile or one pass at a time:
 *   stubble --plow--> plowed --seed--> growing --(fertilize, optional)--> ready --harvest--> stubble
 * By hand a pass covers at most HAND_BATCH tiles. Machinery (bought once per player, chips through the wallet + ledger
 * 'farm_machine') turns a step into a whole-field pass and improves it a little.
 *
 * #27: fertilizer is no longer a per-plot "+% profit" upgrade. It is a consumable you spread on growing tiles. It raises
 * the YIELD (extra crops at the normal sell price). The Farming level also raises yield only; nothing raises the sell
 * price per crop. Bonus crops pay the normal sell price.
 */
export const HAND_BATCH = 4;
export type FarmStep = 'plow' | 'seed' | 'fertilize' | 'harvest';
export type MachineKind = 'tractor' | 'seeder' | 'loader' | 'harvester';
export interface MachineDef { id: MachineKind; label: string; emoji: string; step: FarmStep; price: number; blurb: string }
/** Base chips (scaled by the price index on the server). One of each per player; they work on every plot you own. */
export const MACHINES: MachineDef[] = [
  { id: 'tractor', label: 'Tractor & Plough', emoji: '🚜', step: 'plow', price: 20_000, blurb: 'Plough the whole field in one pass.' },
  { id: 'seeder', label: 'Seed Drill', emoji: '🌱', step: 'seed', price: 35_000, blurb: 'Seed the whole field in one pass. Even rows: crops grow 10% faster.' },
  { id: 'loader', label: 'Front Loader', emoji: '🏗️', step: 'fertilize', price: 25_000, blurb: 'Spread fertilizer on the whole field in one pass, 20% less fertilizer used.' },
  { id: 'harvester', label: 'Combine Harvester', emoji: '🌾', step: 'harvest', price: 60_000, blurb: 'Harvest the whole field in one pass. Less field loss: +10% yield.' },
];
export const machineDef = (k: unknown) => MACHINES.find((m) => m.id === k);
export const SEEDER_GROW_MUL = 0.9;
export const LOADER_DISCOUNT = 0.2;
export const HARVESTER_YIELD = 0.1;
export type MachineSet = Partial<Record<MachineKind, boolean>>;
/** How many tiles one pass of `step` may cover. */
export const passLimit = (step: FarmStep, m: MachineSet, fieldTiles: number) => (MACHINES.some((d) => d.step === step && m[d.id]) ? fieldTiles : HAND_BATCH);

export type FertKind = 'compost' | 'npk' | 'supergro';
export interface FertDef { id: FertKind; label: string; emoji: string; yield: number; costFrac: number }
/** Cost per tile = costFrac × the crop's sell price (base chips), so it is worth it on every crop but with diminishing returns. */
export const FERTILIZERS: FertDef[] = [
  { id: 'compost', label: 'Compost', emoji: '🟫', yield: 0.1, costFrac: 0.04 },
  { id: 'npk', label: 'NPK Granules', emoji: '🧪', yield: 0.25, costFrac: 0.12 },
  { id: 'supergro', label: 'Super-Gro', emoji: '✨', yield: 0.4, costFrac: 0.25 },
];
export const fertDef = (k: unknown) => FERTILIZERS.find((f) => f.id === k);
/** Base-chip cost to fertilize one tile of a crop that sells for `sell` (min 1), with the loader discount if owned. */
export const fertCost = (f: FertDef, sell: number, loader = false) => Math.max(1, Math.round(sell * f.costFrac * (loader ? 1 - LOADER_DISCOUNT : 1)));
/** Yield bonus fraction for one tile: Farming level bonus + fertilizer + combine harvester. Never touches the price. */
export const tileYield = (levelBonus: number, fert: FertKind | null | undefined, harvester: boolean) => levelBonus + (fert ? fertDef(fert)?.yield ?? 0 : 0) + (harvester ? HARVESTER_YIELD : 0);
