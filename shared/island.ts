/**
 * Private Island (Billionaire Update): a small exclusive map reached by Sovereign Megayacht or a private jet.
 * Not a logistics hub and not a ticketed airport destination. Estates are ordinary homes (tax, 70% sell-back, interiors).
 */
import type { Property } from './realEstate.js';

export const ISLAND_X0 = -80, ISLAND_X1 = 80, ISLAND_Z0 = -60, ISLAND_Z1 = 50;
export const ISLAND_SHORE_Z = 18;
export const clampIslandTarget = (x: number, z: number): [number, number] =>
  [Math.min(ISLAND_X1 - 8, Math.max(ISLAND_X0 + 8, x)), Math.min(ISLAND_Z1 - 8, Math.max(ISLAND_Z0 + 8, z))];

export interface IslandLot { id: string; x: number; z: number; w: number; d: number; rot: number; h: number; label: string; price: number }

export const ISLAND_LOTS: IslandLot[] = [
  { id: 'isl:1', x: -36, z: -8, w: 16, d: 14, rot: 0, h: 8, label: 'Cove Estate', price: 2_500_000 },
  { id: 'isl:2', x: 36, z: -8, w: 16, d: 14, rot: 0, h: 8, label: 'Palm Estate', price: 3_200_000 },
  { id: 'isl:3', x: -20, z: -32, w: 18, d: 16, rot: 0.2, h: 10, label: 'Ridge Villa', price: 4_500_000 },
  { id: 'isl:4', x: 22, z: -34, w: 18, d: 16, rot: -0.2, h: 11, label: 'Crown Villa', price: 6_000_000 },
];

export const ISLAND_DOCK = { id: 'i-dock', label: 'Island Dock', icon: '⚓', blurb: 'Sail home to Chud Hub on your megayacht, or fly your jet.', x: 0, z: 28, w: 14, d: 8, h: 3 };

export function islandProperties(): Array<Pick<Property, 'id' | 'kind' | 'type' | 'label' | 'price' | 'x' | 'z' | 'w' | 'd' | 'rot' | 'h' | 'map'>> {
  return ISLAND_LOTS.map((l) => ({ id: l.id, kind: 'building' as const, type: 'isleestate', label: l.label, price: l.price, x: l.x, z: l.z, w: l.w, d: l.d, rot: l.rot, h: l.h, map: 'island' as const }));
}
