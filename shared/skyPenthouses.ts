/**
 * Sky Tower penthouses (Billionaire Update): six buyable units around a civic tower on the ocean beach, next to the Billionaire's Club.
 * IDs are appended to the property catalog and never reshuffle city fill. Interiors use the existing home system.
 */
import { OCEAN } from './ocean.js';

/** Civic tower pad, east of the Billionaire's Club on the beach. */
export const SKY_TOWER = { id: 'skytower', x: -56, z: OCEAN.shoreZ - 6, w: 12, d: 12, rot: 0 as const };

export interface SkyUnit { id: string; floor: number; label: string; price: number; x: number; z: number }

/** Unique 8×8 pads around the tower (no 2D overlap). */
export const SKY_PENTHOUSES: SkyUnit[] = [
  { id: 'sky:1', floor: 12, label: 'Sky Tower · 12th floor', price: 2_000_000, x: -80, z: OCEAN.shoreZ + 8 },
  { id: 'sky:2', floor: 14, label: 'Sky Tower · 14th floor', price: 2_400_000, x: -56, z: OCEAN.shoreZ + 8 },
  { id: 'sky:3', floor: 16, label: 'Sky Tower · 16th floor', price: 2_800_000, x: -32, z: OCEAN.shoreZ + 8 },
  { id: 'sky:4', floor: 18, label: 'Sky Tower · 18th floor', price: 3_200_000, x: -80, z: OCEAN.shoreZ + 20 },
  { id: 'sky:5', floor: 20, label: 'Sky Tower · 20th floor', price: 3_600_000, x: -56, z: OCEAN.shoreZ + 20 },
  { id: 'sky:6', floor: 22, label: 'Sky Tower · Crown penthouse', price: 4_500_000, x: -32, z: OCEAN.shoreZ + 20 },
];

export function skyProperties() {
  return SKY_PENTHOUSES.map((u) => ({
    id: u.id, kind: 'building' as const, type: 'penthouse', label: u.label, price: u.price,
    x: u.x, z: u.z, w: 8, d: 8, rot: 0, h: 14,
  }));
}
