/**
 * Buyable mining pack (carry) upgrades (requested by Jay): permanent per-player tiers above the 120 starter cap.
 * Bought in order, kept forever (Postgres mine_backpack_upgrades), priced in base chips (× the daily price index,
 * same as the Tool Shop). Effects are applied server-side in MinesWorld (hit / creature loot) via capOf.
 */
import { BACKPACK_CAP } from './mines.js';

export type MineBackpackId = 'pack_160' | 'pack_200' | 'pack_250' | 'pack_300';
export interface MineBackpackDef {
  id: MineBackpackId;
  name: string;
  tier: number;
  /** Total carry capacity after this upgrade. */
  cap: number;
  /** Base chips (× price index). */
  price: number;
  blurb: string;
}

export const BACKPACK_UPGRADES: MineBackpackDef[] = [
  { id: 'pack_160', name: 'Roomy Pack',      tier: 1, cap: 160, price: 5_000,   blurb: 'Carry 160 weight, up from 120. Fewer trips back to the EXIT lift.' },
  { id: 'pack_200', name: 'Deep Pack',       tier: 2, cap: 200, price: 15_000,  blurb: 'Carry 200 weight — almost twice the starter pack.' },
  { id: 'pack_250', name: 'Hauler Pack',     tier: 3, cap: 250, price: 45_000,  blurb: 'Carry 250 weight for long trips into the deep floors.' },
  { id: 'pack_300', name: 'Expedition Pack',  tier: 4, cap: 300, price: 110_000, blurb: 'Carry 300 weight, the largest pack: two and a half starter packs.' },
];

export const BACKPACK_BASE_CAP = BACKPACK_CAP;
export const MAX_BACKPACK_TIER = BACKPACK_UPGRADES[BACKPACK_UPGRADES.length - 1]!.tier;
export const MAX_BACKPACK_CAP = BACKPACK_UPGRADES[BACKPACK_UPGRADES.length - 1]!.cap;

export const isMineBackpack = (v: unknown): v is MineBackpackId =>
  typeof v === 'string' && BACKPACK_UPGRADES.some((t) => t.id === v);
export const backpackDef = (v: unknown): MineBackpackDef | null =>
  BACKPACK_UPGRADES.find((t) => t.id === v) ?? null;

export function capForTier(tier: number): number {
  const t = Math.max(0, Math.floor(Number(tier) || 0));
  if (t <= 0) return BACKPACK_BASE_CAP;
  const u = [...BACKPACK_UPGRADES].reverse().find((x) => x.tier <= t);
  return u ? u.cap : BACKPACK_BASE_CAP;
}

export function nextUpgrade(tier: number): MineBackpackDef | null {
  const t = Math.max(0, Math.floor(Number(tier) || 0));
  return BACKPACK_UPGRADES.find((x) => x.tier === t + 1) ?? null;
}

export const canBuyBackpack = (tier: number, id: MineBackpackId) => {
  const d = backpackDef(id);
  return !!d && d.tier === Math.max(0, Math.floor(Number(tier) || 0)) + 1;
};

export interface MineBackpackNext { id: MineBackpackId; name: string; cap: number; price: number }
export interface MineBackpackView {
  cap: number;
  tier: number;
  next: MineBackpackNext | null;
  prices: Record<string, number>;
  index: number;
  signedIn: boolean;
}
