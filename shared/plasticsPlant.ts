/**
 * Chud City Plastics Plant: a public chemical / polymer works. Players import Fort McChud
 * naphtha, ethylene or plastics, then make resin, computer cases, GPUs and other goods
 * that feed furniture and private data centers / bitcoin farms.
 */
export const PLASTICS_NAME = 'Chud City Plastics Plant';

export type FortFeed = 'naphtha' | 'ethylene' | 'plastic';
/** 1 Fort unit imported becomes this many plant units (warehouse goods). */
export const FORT_IMPORT: Record<FortFeed, { good: string; qty: number; name: string }> = {
  naphtha: { good: 'naphtha_drum', qty: 1, name: 'Naphtha drum' },
  ethylene: { good: 'ethylene_tank', qty: 1, name: 'Ethylene tank' },
  plastic: { good: 'plastic_resin', qty: 1, name: 'Plastic resin' },
};

export interface PlantRecipe {
  id: string;
  name: string;
  /** Input warehouse goods. */
  in: Array<[string, number]>;
  out: [string, number];
  /** Seconds. */
  sec: number;
}

export const PLASTICS_RECIPES: PlantRecipe[] = [
  { id: 'resin_from_naphtha', name: 'Resin from naphtha', in: [['naphtha_drum', 2]], out: ['plastic_resin', 3], sec: 8 },
  { id: 'resin_from_ethylene', name: 'Resin from ethylene', in: [['ethylene_tank', 1]], out: ['plastic_resin', 2], sec: 6 },
  { id: 'gpu', name: 'Graphics card', in: [['plastic_resin', 2], ['microchip', 1], ['copper_foil', 2]], out: ['gpu', 1], sec: 14 },
  { id: 'computer', name: 'Computer', in: [['plastic_resin', 4], ['microchip', 2], ['copper_foil', 2], ['glass', 1]], out: ['computer', 1], sec: 18 },
  { id: 'case', name: 'Equipment case', in: [['plastic_resin', 3], ['steel', 1]], out: ['equip_case', 1], sec: 10 },
];

export const plantRecipe = (id: unknown) => PLASTICS_RECIPES.find((r) => r.id === id);
