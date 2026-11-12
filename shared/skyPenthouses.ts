/**
 * Sky Tower penthouses (Billionaire Update): six buyable units in a civic tower in midtown Chud City, east of the Bank.
 * IDs are appended to the property catalog and never reshuffle city fill. Interiors use the existing home system.
 * Units are floors of the tower, so their catalog positions sit on the civic pad; ownership is by stable id (sky:1..sky:6).
 */
import { LANDMARK_SLOTS } from './worldLayout.js';

/** Civic tower pad in the east midtown park. */
export const SKY_TOWER = { id: 'skytower', x: LANDMARK_SLOTS.skytower[0], z: LANDMARK_SLOTS.skytower[1], w: 12, d: 12, rot: 0 as const };

export interface SkyUnit { id: string; floor: number; label: string; price: number; x: number; z: number }

/** Six floors of the civic tower. Catalog pads share the tower site; ids and prices are unchanged. */
export const SKY_PENTHOUSES: SkyUnit[] = [
  { id: 'sky:1', floor: 12, label: 'Sky Tower · 12th floor', price: 2_000_000, x: SKY_TOWER.x, z: SKY_TOWER.z },
  { id: 'sky:2', floor: 14, label: 'Sky Tower · 14th floor', price: 2_400_000, x: SKY_TOWER.x, z: SKY_TOWER.z },
  { id: 'sky:3', floor: 16, label: 'Sky Tower · 16th floor', price: 2_800_000, x: SKY_TOWER.x, z: SKY_TOWER.z },
  { id: 'sky:4', floor: 18, label: 'Sky Tower · 18th floor', price: 3_200_000, x: SKY_TOWER.x, z: SKY_TOWER.z },
  { id: 'sky:5', floor: 20, label: 'Sky Tower · 20th floor', price: 3_600_000, x: SKY_TOWER.x, z: SKY_TOWER.z },
  { id: 'sky:6', floor: 22, label: 'Sky Tower · Crown penthouse', price: 4_500_000, x: SKY_TOWER.x, z: SKY_TOWER.z },
];

export function skyProperties() {
  return SKY_PENTHOUSES.map((u) => ({
    id: u.id, kind: 'building' as const, type: 'penthouse', label: u.label, price: u.price,
    x: u.x, z: u.z, w: 8, d: 8, rot: 0, h: 14,
  }));
}
