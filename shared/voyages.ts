/**
 * Ocean voyages, yacht boarding and opt-in ship combat (Billionaire Update).
 * Voyages are sailed, not ticketed. Boarding is the boat version of jet seats. Combat is opt-in only.
 */
import { crewSeats } from './coop3.js';

export const VOYAGES = [
  { id: 'atoll', name: 'Coral Atoll', minZone: 1 as const, travelMs: 2 * 60_000, fishZone: 1 as const, blurb: 'A ring of sand and palms, an easy first run from the harbour.' },
  { id: 'banks', name: 'Outer Banks', minZone: 1 as const, travelMs: 3 * 60_000, fishZone: 1 as const, blurb: 'Long shoals beyond the reef, in range of a skiff.' },
  { id: 'bluewater', name: 'Blue Water Crossing', minZone: 2 as const, travelMs: 4 * 60_000, fishZone: 2 as const, blurb: 'Open water. A sportfisher or better can make the crossing.' },
  { id: 'isles', name: 'Southern Isles', minZone: 2 as const, travelMs: 5 * 60_000, fishZone: 2 as const, blurb: 'A chain of small islands on the trade wind.' },
  { id: 'abyss', name: 'Abyss Watch', minZone: 3 as const, travelMs: 6 * 60_000, fishZone: 3 as const, blurb: 'Deep water and a long night. Yachts and up only.' },
  { id: 'midnight', name: 'Midnight Reef', minZone: 3 as const, travelMs: 8 * 60_000, fishZone: 3 as const, blurb: 'The far reef, black and gold under the moon.' },
] as const;
export type VoyageId = (typeof VOYAGES)[number]['id'];
export const voyageById = (id: unknown) => VOYAGES.find((v) => v.id === id);
export const canSailVoyage = (boatZone: number, dest: VoyageId) => (voyageById(dest)?.minZone ?? 99) <= boatZone;

export const BOARDING_TTL_MS = 10 * 60_000;
export const SEAT_REQUEST_TTL_MS = 60_000;
export const MAX_YACHT_SEAT_PRICE = 2_000;
export { crewSeats };

export const HULL_HP: Record<string, number> = { skiff: 40, sportfisher: 70, yacht: 100, superyacht: 140, megayacht: 180 };
export const hullHp = (model: string) => HULL_HP[model] ?? 40;
export const FIRE_MIN = 12;
export const FIRE_MAX = 20;
export const COMBAT_RAKE = 0.05;
export const MAX_COMBAT_STAKE = 1_000_000;
export const REPAIR_RATE = 0.01; // of the boat's base price
export const FLEE_DAMAGE = 10;

export type VoyagePhase = 'underway' | 'arrived' | 'returning';
export interface VoyageView {
  id: string; dest: VoyageId; destName: string; phase: VoyagePhase;
  captain: string; boat: string; boatName: string; crew: string[];
  startedAt: number; arrivesAt: number; fishZone: number;
}
export interface YachtBoardingView {
  id: string; owner: string; boat: string; boatName: string; dest: VoyageId | 'island';
  seats: number; price: number; openedAt: number; expiresAt: number;
  seated: string[]; pending: Array<{ name: string; at: number; expiresAt: number }>;
}
export interface FightView {
  id: string; a: { name: string; boat: string; hp: number; max: number }; b: { name: string; boat: string; hp: number; max: number };
  stake: number; rake: number; toAct: string; startedAt: number;
}
