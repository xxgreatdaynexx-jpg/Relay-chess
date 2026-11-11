/**
 * Hyper farm: a staged conversion of an owned farm into a Dutch-style greenhouse.
 * Flowers and other difficult crops can be planted after the glasshouse is finished.
 */
import { HYPER_CROPS, isHyperCrop, type Crop } from './farm.js';
export { HYPER_CROPS, isHyperCrop };
export const hyperCropById = (id: unknown): Crop | undefined => HYPER_CROPS.find((c) => c.id === id);

export const HYPER_FARM_TOTAL = 1_800_000;
export type HyperStageId = 'foundations' | 'frame' | 'glass' | 'climate';
export interface HyperStagePlan { id: HyperStageId; name: string; chips: number; goods: Array<[string, number]> }
export const HYPER_STAGES: HyperStagePlan[] = [
  { id: 'foundations', name: 'Beds & service trench', chips: 220_000, goods: [['concrete', 1_200], ['brick', 400]] },
  { id: 'frame', name: 'Steel frame', chips: 260_000, goods: [['steel_beam', 500], ['steel', 200]] },
  { id: 'glass', name: 'Glasshouse skin', chips: 280_000, goods: [['tempered_glass', 600], ['steel_cable', 200]] },
  { id: 'climate', name: 'Climate & irrigation', chips: 240_000, goods: [['pump', 40], ['sensor', 60], ['valve', 80], ['fiber_optic', 40]] },
];

export const HYPER_GROW_MUL = 0.7;
export const HYPER_WITHER_FACTOR = 8;

export const HYPER_RULES = 'Converting a farm to a hyper farm is a four-stage construction. Ordinary crops still grow there while you build. Flowers and other difficult crops unlock when the glasshouse is finished. The conversion cannot be undone.';
